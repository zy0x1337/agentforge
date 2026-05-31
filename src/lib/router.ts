/**
 * Hybrid Router
 *   1. Rule-based: keyword matching against agent triggers (fast, deterministic)
 *   2. LLM-based:  fallback — asks the default model to pick the best agent
 */

import { chat } from "./ollama";
import type { Agent } from "@/types";

function ruleBasedMatch(prompt: string, agents: Agent[]): Agent | null {
  const lower = prompt.toLowerCase();
  let best: Agent | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    const triggers = agent.frontmatter.triggers ?? [];
    let score = 0;
    for (const trigger of triggers) {
      if (lower.includes(trigger.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = agent;
    }
  }

  return bestScore > 0 ? best : null;
}

async function llmBasedMatch(
  prompt: string,
  agents: Agent[],
  model: string
): Promise<Agent | null> {
  const agentList = agents
    .map(
      (a) =>
        `- id: "${a.id}" | name: "${a.frontmatter.name}" | description: "${a.frontmatter.description}"`
    )
    .join("\n");

  const systemMsg = `You are a routing agent. Given a user prompt and a list of available agents, respond with ONLY the agent id that best matches the task. If none fit, respond with "none".`;
  const userMsg = `User prompt: "${prompt}"\n\nAvailable agents:\n${agentList}\n\nRespond with only the agent id.`;

  const response = await chat(
    model,
    [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
    0.1
  );

  const id = response.trim().replace(/^"|"$/g, "");
  return agents.find((a) => a.id === id) ?? null;
}

/** Main router: rule-based first, LLM fallback */
export async function routeToAgent(
  prompt: string,
  agents: Agent[],
  routerModel: string,
  skipLlm = false
): Promise<Agent | null> {
  const routable = agents.filter((a) => !a.id.startsWith("_"));

  const ruleMatch = ruleBasedMatch(prompt, routable);
  if (ruleMatch) return ruleMatch;

  if (skipLlm) return routable[0] ?? null;

  return llmBasedMatch(prompt, routable, routerModel);
}

/** Determine next agent after a step completes — hybrid: frontmatter first, LLM fallback */
export async function routeNext(
  currentAgent: Agent,
  output: string,
  allAgents: Agent[],
  routerModel: string
): Promise<Agent | null> {
  const routable = allAgents.filter(
    (a) => !a.id.startsWith("_") && a.id !== currentAgent.id
  );

  // Rule-based: explicit declaration in frontmatter
  const explicit = currentAgent.frontmatter.next_agents ?? [];
  if (explicit.length > 0) {
    const next = routable.find((a) => a.id === explicit[0]);
    if (next) return next;
  }

  // LLM-based: ask the model if the task needs continuation
  const agentList = routable
    .map((a) => `- id: "${a.id}" | "${a.frontmatter.name}": ${a.frontmatter.description}`)
    .join("\n");

  const systemMsg = `You are a workflow orchestrator. Based on the last agent output, decide if another agent should continue the task. Respond with ONLY the next agent id, or "done" if the workflow is complete.`;
  const userMsg = `Last agent output:\n${output.slice(0, 800)}\n\nAvailable agents:\n${agentList}`;

  const response = await chat(
    routerModel,
    [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
    0.1
  );

  const id = response.trim().replace(/^"|"$/g, "");
  if (id === "done" || id === "") return null;
  return routable.find((a) => a.id === id) ?? null;
}
