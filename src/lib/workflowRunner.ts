/**
 * Workflow Runner — executes a chain of agents, manages context budget.
 *
 * Context modes (set per-agent in persona.md frontmatter):
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
import type { Agent, WorkflowRun, WorkflowStep, ChatMessage } from "@/types";

const MAX_STEPS = 8;

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
  contextMode: "full" | "summary" | "none"
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
    agent.prompt?.replace("{{input}}", userPrompt) ?? userPrompt;
  messages.push({ role: "user", content: promptTemplate });

  return messages;
}

export async function runWorkflow(
  initialPrompt: string,
  agents: Agent[],
  routerModel: string,
  defaultModel: string,
  onStep: (step: WorkflowStep) => void,
  onChunk: (agentId: string, token: string) => void,
  signal?: AbortSignal
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    initialPrompt,
    steps: [],
    status: "running",
  };

  // Immediately check if already aborted before we even start
  if (signal?.aborted) {
    run.status = "aborted";
    return run;
  }

  let currentAgent = await routeToAgent(initialPrompt, agents, routerModel, signal);
  if (!currentAgent) {
    run.status = "error";
    return run;
  }

  let previousOutput: string | null = null;
  let stepCount = 0;

  while (currentAgent && stepCount < MAX_STEPS) {
    // Check abort at the top of every step
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
      initialPrompt,
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
