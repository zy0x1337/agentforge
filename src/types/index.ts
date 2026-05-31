// ── Agent & Workflow types ────────────────────────────────────────────────────

export interface AgentFrontmatter {
  name: string;
  description: string;
  model?: string;
  temperature?: number;
  triggers?: string[];
  next_agents?: string[];
  context_mode?: 'full' | 'summary' | 'none';
  max_tokens?: number;
  tools?: string[];
  tags?: string[];
}

export interface Agent {
  id: string;
  path: string;
  frontmatter: AgentFrontmatter;
  persona: string;
  prompt?: string;
  /** Raw contents of workflow.md — present only if the file exists. */
  workflow?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  timestamp: number;
}

// ── Parallel execution types ──────────────────────────────────────────────────

/** Status of a single agent inside a parallel group. */
export type AgentResultStatus = 'ok' | 'error' | 'timeout' | 'aborted';

/** Result produced by one agent inside a parallel fan-out group. */
export interface AgentResult {
  agentId: string;
  output: string;
  durationMs: number;
  status: AgentResultStatus;
  error?: string;
}

/** Merge strategies for parallel fan-in. */
export type MergeStrategy = 'concat' | 'summarise' | 'vote';

/** Full result returned by runParallelStep() after all agents finish. */
export interface ParallelRunResult {
  merged: string;
  results: AgentResult[];
  strategy: MergeStrategy;
  totalDurationMs: number;
  /** True if at least one agent in the group succeeded. */
  anySucceeded: boolean;
}

/**
 * A parallel group step as parsed from workflow.md frontmatter.
 * Used by workflowRunner when dispatching to parallelRunner.
 */
export interface ParallelGroupStep {
  agents: string[];
  mode: 'parallel';
  merge_strategy?: MergeStrategy;
  /** Per-agent timeout in milliseconds (default: 120 000). */
  timeout_ms?: number;
}

// ── Workflow step (sequential or parallel) ────────────────────────────────────

/**
 * Represents one step in a WorkflowRun — either a single sequential agent
 * or a parallel fan-out group.
 *
 * Sequential steps have `agentId`.
 * Parallel steps have `parallelGroup` and aggregate results from all agents.
 */
export interface WorkflowStep {
  /** Present for sequential steps. */
  agentId?: string;
  input: string;
  output?: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted';
  contextMode: 'full' | 'summary' | 'none';
  /** True when this step was skipped due to a condition evaluating to false. */
  skipped?: boolean;
  /** Present for parallel steps — contains per-agent results and merged output. */
  parallelGroup?: {
    agentIds: string[];
    results: AgentResult[];
    mergedOutput: string;
    strategy: MergeStrategy;
    succeededCount: number;
    totalDurationMs: number;
  };
}

export interface WorkflowRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  initialPrompt: string;
  steps: WorkflowStep[];
  status: 'running' | 'done' | 'error' | 'aborted';
  /** "static" when driven by workflow.md, "dynamic" when driven by the router. */
  executionMode?: 'static' | 'dynamic';
}

// ── Ollama types ──────────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ── App state ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  agentsDir: string;
  defaultModel: string;
  ollamaBaseUrl: string;
  theme: 'light' | 'dark' | 'system';
  routingMode?: 'full' | 'rules_llm' | 'keyword_only';
  embeddingModel?: string;
}

// ── Re-exports from parallelRunner (single import surface) ───────────────────
// Consumers import from '@/types' rather than reaching into lib/parallelRunner.
export type { ParallelRunnerDeps } from '../lib/parallelRunner';
