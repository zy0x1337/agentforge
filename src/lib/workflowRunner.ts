/**
 * Workflow Runner — executes a chain of agents, manages context budget.
 *
 * Context modes (set per-agent in persona.md frontmatter):
 *   full    → pass the full previous output as context
 *   summary → summarise previous output first (safe for long chains)
 *   none    → start fresh, only the original user prompt
 */

import { chat, chatStream } from "./ollama";
import { routeToAgent, routeNext } from "./router";
import type { Agent, WorkflowRun, WorkflowStep, ChatMessage } from "@/types";

const MAX_STEPS = 8;

async function summarize(text: string, model: string): Promise<string> {
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
    512
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
  onChunk: (agentId: string, token: string) => void
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    initialPrompt,
    steps: [],
    status: "running",
  };

  let currentAgent = await routeToAgent(initialPrompt, agents, routerModel);
  if (!currentAgent) {
    run.status = "error";
    return run;
  }

  let previousOutput: string | null = null;
  let stepCount = 0;

  while (currentAgent && stepCount < MAX_STEPS) {
    stepCount++;
    const model = currentAgent.frontmatter.model || defaultModel;
    const contextMode = currentAgent.frontmatter.context_mode ?? "summary";

    let contextContent = previousOutput;
    if (contextContent && contextMode === "summary") {
      contextContent = await summarize(contextContent, model);
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
        currentAgent.frontmatter.temperature ?? 0.7
      );

      step.output = output;
      step.status = "done";
      previousOutput = output;
      onStep({ ...step });
      run.steps.push({ ...step });
    } catch (err) {
      step.status = "error";
      step.output = String(err);
      onStep({ ...step });
      run.steps.push({ ...step });
      run.status = "error";
      return run;
    }

    currentAgent = await routeNext(
      currentAgent,
      previousOutput ?? "",
      agents,
      routerModel
    );
  }

  run.status = "done";
  return run;
}
