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
 *             step using next_agents + LLM fallback. Original behaviour preserved.
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
import { routeToAgent, routeNext } from "./router";
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

  // Step-level prompt_override > agent's prompt.md template > bare user prompt
  const promptTemplate =
    promptOverride
      ? promptOverride
          .replace("{{input}}", userPrompt)
          .replace("{{previous}}", previousOutput ?? "")
      : (agent.prompt?.replace("{{input}}", userPrompt) ?? userPrompt);

  messages.push({ role: "user", content: promptTemplate });

  return messages;
}

function findAgent(agents: Agent[], id: string): Agent | undefined {
  return agents.find((a) => a.id === id);
}

// ── Run helpers ───────────────────────────────────────────────────────────────

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

  let previousOutput: string | null = null;
  let stepCount = 0;

  for (const stepDef of definition.steps) {
    if (signal?.aborted) {
      run.status = "aborted";
      run.finishedAt = Date.now();
      return run;
    }

    // ── Condition check ─────────────────────────────────────────────────────
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

    // ── Resolve agent ────────────────────────────────────────────────────────
    const agent = findAgent(agents, stepDef.agent);
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
      continue; // "continue" or "retry" — just skip for now, retry handled below
    }

    // ── Resolve per-step overrides ───────────────────────────────────────────
    const model =
      stepDef.model ?? agent.frontmatter.model ?? defaultModel;
    const contextMode =
      stepDef.context_mode ?? agent.frontmatter.context_mode ?? "summary";
    const temperature =
      stepDef.temperature ?? agent.frontmatter.temperature ?? 0.7;

    // ── Summarise context if needed ──────────────────────────────────────────
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

    // ── Execute with retry support ────────────────────────────────────────────
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
          (token) => {
            output += token;
            onChunk(agent.id, token);
          },
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
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";
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
          step.output =
            attempt > 1
              ? `[failed after ${attempt} attempts] ${String(err)}`
              : String(err);
          onStep({ ...step });
          run.steps.push({ ...step });

          if (definition.onError === "stop") {
            run.status = "error";
            run.finishedAt = Date.now();
            return run;
          }
          // "continue" — record the error step, move on
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

// ── Dynamic execution (router driven) ────────────────────────────────────────

async function runDynamicWorkflow(
  run: WorkflowRun,
  agents: Agent[],
  routerModel: string,
  defaultModel: string,
  onStep: (step: WorkflowStep) => void,
  onChunk: (agentId: string, token: string) => void,
  signal?: AbortSignal
): Promise<WorkflowRun> {
  if (signal?.aborted) {
    run.status = "aborted";
    return run;
  }

  let currentAgent = await routeToAgent(
    run.initialPrompt,
    agents,
    routerModel,
    signal
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
    const model = currentAgent.frontmatter.model || defaultModel;
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
        (token) => {
          output += token;
          onChunk(currentAgent!.id, token);
        },
        currentAgent.frontmatter.temperature ?? 0.7,
        signal
      );

      step.output = output;
      step.status = "done";
      previousOutput = output;
      onStep({ ...step });
      run.steps.push({ ...step });
    } catch (err) {
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";

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
      signal
    );
  }

  run.status = "done";
  run.finishedAt = Date.now();
  return run;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a workflow starting from initialPrompt.
 *
 * If any agent in the resolved starting set has a workflow.md, the static
 * execution path is used for that agent's definition. Otherwise the dynamic
 * router-driven path runs.
 *
 * The caller decides which mode to invoke by passing workflowSource:
 *   - string  → static mode (contents of workflow.md)
 *   - null    → dynamic mode (router selects agents)
 */
export async function runWorkflow(
  initialPrompt: string,
  agents: Agent[],
  routerModel: string,
  defaultModel: string,
  onStep: (step: WorkflowStep) => void,
  onChunk: (agentId: string, token: string) => void,
  signal?: AbortSignal,
  workflowSource?: string | null
): Promise<WorkflowRun> {
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
        // Fall back to dynamic if workflow.md is malformed — surface a warning step
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
    signal
  );
}
