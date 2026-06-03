/**
 * Hybrid Router — three-tier fallback chain:
 *
 *   Tier 1 — Rule-based    keyword matching against agent triggers  (fast, zero API calls)
 *   Tier 2 — Semantic      cosine similarity via nomic-embed-text   (accurate, 2 API calls)
 *   Tier 3 — LLM           asks the default model to pick directly  (slowest, last resort)
 *
 * Tier 2 requires the embed model to be available locally. If Ollama returns an
 * error (model not pulled, service down, etc.) the router silently falls through
 * to Tier 3 so the app never hard-fails on routing.
 *
 * Tier selection is controlled by the skipSemantic / skipLlm flags, which lets
 * the Settings panel expose routing-mode options to the user.
 */

import { chat } from "./ollama";
import {
  getBatchEmbeddings,
  getEmbedding,
  rankBySimilarity,
} from "./embeddings";
import type { Agent } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum cosine similarity to accept a semantic match (empirically tuned for nomic-embed-text). */
const SEMANTIC_THRESHOLD = 0.35;

/** Default embed model. User can override in Settings. */
export const DEFAULT_EMBED_MODEL = "nomic-embed-text";

// ── Tier 1: Rule-based ────────────────────────────────────────────────────────

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

// ── Tier 2: Semantic ──────────────────────────────────────────────────────────

/**
 * Build the agent "document" that gets embedded.
 *
 * We concatenate name + description + triggers so the vector captures both
 * the agent's stated purpose and the vocabulary of tasks it handles.
 */
function agentEmbedText(agent: Agent): string {
  const parts: string[] = [
    agent.frontmatter.name,
    agent.frontmatter.description,
    ...(agent.frontmatter.triggers ?? []),
  ];
  return parts.filter(Boolean).join(". ");
}

async function semanticMatch(
  prompt: string,
  agents: Agent[],
  embedModel: string,
  baseUrl: string,
  signal?: AbortSignal
): Promise<Agent | null> {
  // Build (id → embedText) map for batch fetch
  const agentItems = agents.map((a) => ({
    id: a.id,
    text: agentEmbedText(a),
  }));

  // Fetch all agent vectors (cached after first call) + query vector in parallel
  const [agentVectors, queryVector] = await Promise.all([
    getBatchEmbeddings(agentItems, embedModel, baseUrl, signal),
    getEmbedding(
      prompt,
      embedModel,
      baseUrl,
      undefined, // prompts are not cached — they vary every run
      signal
    ),
  ]);

  const ranked = rankBySimilarity(queryVector, agentVectors);

  if (ranked.length === 0) return null;

  const top = ranked[0];

  console.debug(
    `[router] Semantic scores: ${ranked
      .slice(0, 5)
      .map((r) => `${r.id}=${r.score.toFixed(3)}`)
      .join(", ")}`
  );

  if (top.score < SEMANTIC_THRESHOLD) {
    console.debug(
      `[router] Top semantic score ${top.score.toFixed(3)} < threshold ${SEMANTIC_THRESHOLD} — falling through to LLM tier`
    );
    return null;
  }

  return agents.find((a) => a.id === top.id) ?? null;
}

// ── Tier 3: LLM ───────────────────────────────────────────────────────────────

async function llmBasedMatch(
  prompt: string,
  agents: Agent[],
  model: string,
  signal?: AbortSignal
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
    0.1,
    undefined,
    signal
  );

  const id = response.trim().replace(/^"|"$/g, "");
  return agents.find((a) => a.id === id) ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RouterOptions {
  /** Ollama base URL (e.g. http://localhost:11434). Required for Tier 2. */
  baseUrl?: string;
  /** Embedding model name. Defaults to nomic-embed-text. */
  embedModel?: string;
  /** Skip Tier 2 (semantic). Falls straight from rule-based to LLM. */
  skipSemantic?: boolean;
  /** Skip Tier 3 (LLM). Falls back to first available agent on no match. */
  skipLlm?: boolean;
  signal?: AbortSignal;
}

/**
 * Main router: Tier 1 → Tier 2 → Tier 3.
 *
 * Agents whose id starts with "_" are excluded from routing
 * (convention: _global, _system, etc.).
 */
export async function routeToAgent(
  prompt: string,
  agents: Agent[],
  routerModel: string,
  options: RouterOptions = {}
): Promise<Agent | null> {
  const {
    baseUrl = "http://localhost:11434",
    embedModel = DEFAULT_EMBED_MODEL,
    skipSemantic = false,
    skipLlm = false,
    signal,
  } = options;

  const routable = agents.filter((a) => !a.id.startsWith("_"));
  if (routable.length === 0) return null;

  // ── Tier 1: Rule-based ────────────────────────────────────────────────────
  const ruleMatch = ruleBasedMatch(prompt, routable);
  if (ruleMatch) {
    console.debug(`[router] Tier 1 match: ${ruleMatch.id}`);
    return ruleMatch;
  }

  // ── Tier 2: Semantic ──────────────────────────────────────────────────────
  if (!skipSemantic) {
    try {
      const semanticResult = await semanticMatch(
        prompt,
        routable,
        embedModel,
        baseUrl,
        signal
      );
      if (semanticResult) {
        console.debug(`[router] Tier 2 match: ${semanticResult.id}`);
        return semanticResult;
      }
    } catch (err) {
      // Embed model likely not pulled or Ollama unreachable — soft fail
      console.warn(
        `[router] Semantic routing failed, falling through to LLM tier: ${String(err)}`
      );
    }
  }

  // ── Tier 3: LLM ───────────────────────────────────────────────────────────
  if (skipLlm) {
    console.debug("[router] LLM tier skipped — no rule/semantic match, returning null");
    return null;
  }

  const llmResult = await llmBasedMatch(prompt, routable, routerModel, signal);
  if (llmResult) {
    console.debug(`[router] Tier 3 match: ${llmResult.id}`);
  }
  return llmResult;
}

/**
 * Determine next agent after a step completes.
 *
 * Priority:
 *   1. Explicit next_agents in frontmatter (deterministic)
 *   2. Semantic similarity of the output to remaining agents
 *   3. LLM-based orchestration decision
 */
export async function routeNext(
  currentAgent: Agent,
  output: string,
  allAgents: Agent[],
  routerModel: string,
  options: RouterOptions = {}
): Promise<Agent | null> {
  const {
    baseUrl = "http://localhost:11434",
    embedModel = DEFAULT_EMBED_MODEL,
    skipSemantic = false,
    skipLlm = false,
    signal,
  } = options;

  const routable = allAgents.filter(
    (a) => !a.id.startsWith("_") && a.id !== currentAgent.id
  );

  // ── Explicit next_agents ──────────────────────────────────────────────────
  const explicit = currentAgent.frontmatter.next_agents ?? [];
  if (explicit.length > 0) {
    const next = routable.find((a) => a.id === explicit[0]);
    if (next) return next;
  }

  // ── Semantic: match output against remaining agents ───────────────────────
  if (!skipSemantic) {
    try {
      // Use a trimmed excerpt of the output as the query — keeps vectors focused
      const query = output.slice(0, 512);
      const agentItems = routable.map((a) => ({
        id: a.id,
        text: agentEmbedText(a),
      }));

      const [agentVectors, queryVector] = await Promise.all([
        getBatchEmbeddings(agentItems, embedModel, baseUrl, signal),
        getEmbedding(query, embedModel, baseUrl, undefined, signal),
      ]);

      const ranked = rankBySimilarity(queryVector, agentVectors);
      const top = ranked[0];

      if (top && top.score >= SEMANTIC_THRESHOLD) {
        const next = routable.find((a) => a.id === top.id);
        if (next) {
          console.debug(
            `[router] routeNext — Tier 2 match: ${next.id} (score=${top.score.toFixed(3)})`
          );
          return next;
        }
      }
    } catch (err) {
      console.warn(
        `[router] routeNext semantic failed, falling through to LLM: ${String(err)}`
      );
    }
  }

  // ── LLM orchestration ─────────────────────────────────────────────────────
  if (skipLlm) return null;

  const agentList = routable
    .map(
      (a) =>
        `- id: "${a.id}" | "${a.frontmatter.name}": ${a.frontmatter.description}`
    )
    .join("\n");

  const systemMsg = `You are a workflow orchestrator. Based on the last agent output, decide if another agent should continue the task. Respond with ONLY the next agent id, or "done" if the workflow is complete.`;
  const userMsg = `Last agent output:\n${output.slice(0, 800)}\n\nAvailable agents:\n${agentList}`;

  const response = await chat(
    routerModel,
    [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
    0.1,
    undefined,
    signal
  );

  const id = response.trim().replace(/^"|"$/g, "");
  if (id === "done" || id === "") return null;
  return routable.find((a) => a.id === id) ?? null;
}
