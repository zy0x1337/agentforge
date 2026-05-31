/**
 * Workflow Runner — executes a chain of agents, manages context budget.
 *
 * Execution modes:
 *
 *   STATIC  — an agent folder contains a workflow.md. The parsed WorkflowDefinition
 *             drives the exact step sequence, per-step overrides, conditions, and
 *             on_error behaviour. The router is NOT called between steps.
 *
 *   DYNAMIC — no workflow.md present (or parseWorkflow throws). The router selects
 *             the first agent from the initial prompt, then re-routes after every
 *             step using next_agents + semantic similarity + LLM fallback.
 *
 * Context modes (set per-agent in persona.md or overridden per-step in workflow.md):
 *   full    → pass the full previous output as context
 *   summary → summarise previous output first (safe for long chains)
 *   none    → start fresh, only the original user prompt
 *
 * Abort:
 *   Pass an AbortSignal to cancel mid-run. The runner throws an
 *   "AbortError" which sets the run status to "aborted".
 */

import { chat, chatStream } from "./ollama";
import { routeToAgent, routeNext, RouterOptions } from "./router";
import { parseWorkflow, evaluateCondition, WorkflowParseError } from "./workflowParser";
import type { Agent, WorkflowRun, WorkflowStep, ChatMessage } from "@/types";

const MAX_DYNAMIC_STEPS = 8;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function summarize(
  text: string,
  model: string,
  signal?: AbortSignal
): Promise<string> {
  return chat(
    model,
    [
      {
        role: "system",
        content:
          "Summarize the following assistant output in 3-5 sentences, preserving key decisions and outputs.",
      },
      { role: "user", content: text },
    ],
    0.3,
    512,
    signal
  );
}

function buildMessages(
  agent: Agent,
  userPrompt: string,
  previousOutput: string | null,
  contextMode: "full" | "summary" | "none",
  promptOverride?: string
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (agent.persona) {
    messages.push({ role: "system", content: agent.persona });
  }

  if (previousOutput && contextMode !== "none") {
    messages.push({
      role: "system",
      content: `--- Previous agent output (${contextMode}) ---\n${previousOutput}`,
    });
  }

  const promptTemplate =
    promptOverride
      ? promptOverride
          .replace("{{input}}", userPrompt)
          .replace("{{previous}}", previousOutput ?? "")
      : (agent.prompt?.replace("{{input}}", userPrompt) ?? userPrompt);

  messages.push({ role: "user", content: promptTemplate });

  return messages;
}

function makeRun(initialPrompt: string): WorkflowRun {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    initialPrompt,
    steps: [],
    status: "running",
  };
}

// ── Static execution (workflow.md driven) ─────────────────────────────────────

async function runStaticWorkflow(
  run: WorkflowRun,
  workflowSource: string,
  agents: Agent[],
  defaultModel: string,
  onStep: (step: WorkflowStep) => void,
  onChunk: (agentId: string, token: string) => void,
  signal?: AbortSignal
): Promise<WorkflowRun> {
  const definition = parseWorkflow(workflowSource);
  run.executionMode = "static";

  let previousOutput: string | null = null;
  let stepCount = 0;

  for (const stepDef of definition.steps) {
    if (signal?.aborted) {
      run.status = "aborted";
      run.finishedAt = Date.now();
      return run;
    }

    const conditionMet = evaluateCondition(stepDef.condition, {
      previousOutput: previousOutput ?? "",
      stepCount,
    });
    if (!conditionMet) {
      console.info(
        `[workflowRunner] Skipping step '${stepDef.agent}' — condition not met: ${stepDef.condition}`
      );
      continue;
    }

    const agent = agents.find((a) => a.id === stepDef.agent);
    if (!agent) {
      const errStep: WorkflowStep = {
        agentId: stepDef.agent,
        input: run.initialPrompt,
        output: `Agent '${stepDef.agent}' not found in agents directory.`,
        status: "error",
        contextMode: "none",
      };
      onStep(errStep);
      run.steps.push(errStep);
      if (definition.onError === "stop") {
        run.status = "error";
        run.finishedAt = Date.now();
        return run;
      }
      continue;
    }

    const model       = stepDef.model        ?? agent.frontmatter.model        ?? defaultModel;
    const contextMode = stepDef.context_mode ?? agent.frontmatter.context_mode ?? "summary";
    const temperature = stepDef.temperature  ?? agent.frontmatter.temperature  ?? 0.7;

    let contextContent = previousOutput;
    if (contextContent && contextMode === "summary") {
      contextContent = await summarize(contextContent, model, signal);
    }

    const messages = buildMessages(
      agent,
      run.initialPrompt,
      contextContent,
      contextMode,
      stepDef.prompt_override
    );

    const step: WorkflowStep = {
      agentId: agent.id,
      input: messages[messages.length - 1].content,
      status: "running",
      contextMode,
    };
    onStep(step);

    const maxAttempts =
      definition.onError === "retry" ? definition.maxRetries + 1 : 1;
    let attempt = 0;
    let succeeded = false;

    while (attempt < maxAttempts && !succeeded) {
      attempt++;
      try {
        let output = "";
        await chatStream(
          model,
          messages,
          (token) => { output += token; onChunk(agent.id, token); },
          temperature,
          signal
        );
        step.output = output;
        step.status = "done";
        previousOutput = output;
        stepCount++;
        onStep({ ...step });
        run.steps.push({ ...step });
        succeeded = true;
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (isAbort) {
          step.status = "aborted";
          step.output = "[aborted by user]";
          onStep({ ...step });
          run.steps.push({ ...step });
          run.status = "aborted";
          run.finishedAt = Date.now();
          return run;
        }
        if (attempt >= maxAttempts) {
          step.status = "error";
          step.output = attempt > 1
            ? `[failed after ${attempt} attempts] ${String(err)}`
            : String(err);
          onStep({ ...step });
          run.steps.push({ ...step });
          if (definition.onError === "stop") {
            run.status = "error";
            run.finishedAt = Date.now();
            return run;
          }
        } else {
          console.warn(
            `[workflowRunner] Step '${agent.id}' failed (attempt ${attempt}/${maxAttempts}), retrying…`
          );
        }
      }
    }
  }

  run.status = "done";
  run.finishedAt = Date.now();
  return run;
}

// ── Dynamic execution (router driven) ─────────────────────────────────────────

async function runDynamicWorkflow(
  run: WorkflowRun,
  agents: Agent[],
  routerModel: string,
  defaultModel: string,
  onStep: (step: WorkflowStep) => void,
  onChunk: (agentId: string, token: string) => void,
  routerOptions: RouterOptions,
  signal?: AbortSignal
): Promise<WorkflowRun> {
  run.executionMode = "dynamic";

  if (signal?.aborted) {
    run.status = "aborted";
    return run;
  }

  let currentAgent = await routeToAgent(
    run.initialPrompt,
    agents,
    routerModel,
    { ...routerOptions, signal }
  );
  if (!currentAgent) {
    run.status = "error";
    return run;
  }

  let previousOutput: string | null = null;
  let stepCount = 0;

  while (currentAgent && stepCount < MAX_DYNAMIC_STEPS) {
    if (signal?.aborted) {
      run.status = "aborted";
      run.finishedAt = Date.now();
      return run;
    }

    stepCount++;
    const model       = currentAgent.frontmatter.model        || defaultModel;
    const contextMode = currentAgent.frontmatter.context_mode ?? "summary";

    let contextContent = previousOutput;
    if (contextContent && contextMode === "summary") {
      contextContent = await summarize(contextContent, model, signal);
    }

    const messages = buildMessages(
      currentAgent,
      run.initialPrompt,
      contextContent,
      contextMode
    );

    const step: WorkflowStep = {
      agentId: currentAgent.id,
      input: messages[messages.length - 1].content,
      status: "running",
      contextMode,
    };
    onStep(step);

    try {
      let output = "";
      await chatStream(
        model,
        messages,
        (token) => { output += token; onChunk(currentAgent!.id, token); },
        currentAgent.frontmatter.temperature ?? 0.7,
        signal
      );
      step.output = output;
      step.status = "done";
      previousOutput = output;
      onStep({ ...step });
      run.steps.push({ ...step });
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (isAbort) {
        step.status = "aborted";
        step.output = "[aborted by user]";
        onStep({ ...step });
        run.steps.push({ ...step });
        run.status = "aborted";
        run.finishedAt = Date.now();
        return run;
      }
      step.status = "error";
      step.output = String(err);
      onStep({ ...step });
      run.steps.push({ ...step });
      run.status = "error";
      run.finishedAt = Date.now();
      return run;
    }

    currentAgent = await routeNext(
      currentAgent,
      previousOutput ?? "",
      agents,
      routerModel,
      { ...routerOptions, signal }
    );
  }

  run.status = "done";
  run.finishedAt = Date.now();
  return run;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RunWorkflowOptions {
  /** Raw workflow.md contents → static mode. Null/undefined → dynamic mode. */
  workflowSource?: string | null;
  /** Forwarded to the router for Tier 2 (semantic) and Tier 3 (LLM) routing. */
  routerOptions?: RouterOptions;
  signal?: AbortSignal;
}

export async function runWorkflow(
  initialPrompt: string,
  agents: Agent[],
  routerModel: string,
  defaultModel: string,
  onStep: (step: WorkflowStep) => void,
  onChunk: (agentId: string, token: string) => void,
  options: RunWorkflowOptions = {}
): Promise<WorkflowRun> {
  const { workflowSource, routerOptions = {}, signal } = options;
  const run = makeRun(initialPrompt);

  if (workflowSource) {
    try {
      return await runStaticWorkflow(
        run,
        workflowSource,
        agents,
        defaultModel,
        onStep,
        onChunk,
        signal
      );
    } catch (e) {
      if (e instanceof WorkflowParseError) {
        const warnStep: WorkflowStep = {
          agentId: "_system",
          input: "",
          output: `⚠ workflow.md parse error — falling back to dynamic routing.\n\n${e.message}`,
          status: "error",
          contextMode: "none",
        };
        onStep(warnStep);
        run.steps.push(warnStep);
      } else {
        throw e;
      }
    }
  }

  return runDynamicWorkflow(
    run,
    agents,
    routerModel,
    defaultModel,
    onStep,
    onChunk,
    routerOptions,
    signal
  );
}
