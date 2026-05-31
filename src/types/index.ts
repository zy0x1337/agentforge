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

export type AgentResultStatus = 'ok' | 'error' | 'timeout' | 'aborted';

export interface AgentResult {
  agentId: string;
  output: string;
  durationMs: number;
  status: AgentResultStatus;
  error?: string;
}

export type MergeStrategy = 'concat' | 'summarise' | 'vote';

export interface ParallelRunResult {
  merged: string;
  results: AgentResult[];
  strategy: MergeStrategy;
  totalDurationMs: number;
  anySucceeded: boolean;
}

export interface ParallelGroupStep {
  agents: string[];
  mode: 'parallel';
  merge_strategy?: MergeStrategy;
  timeout_ms?: number;
}

// ── Run events (canonical — single source of truth) ───────────────────────────
// Both workflowRunner and parallelRunner import RunEvent from here.

export type RunEvent =
  | { type: 'run_start';           runId: string; prompt: string; timestamp: number }
  | { type: 'agent_start';         runId: string; agentId: string; timestamp: number }
  | { type: 'agent_chunk';         runId: string; agentId: string; chunk: string; timestamp: number }
  | { type: 'agent_done';          runId: string; agentId: string; output: string; durationMs: number; timestamp: number }
  | { type: 'agent_error';         runId: string; agentId: string; error: string; status: 'error' | 'aborted'; timestamp: number }
  | { type: 'parallel_group_done'; runId: string; agentIds: string[]; succeededCount: number; totalCount: number; mergedOutput: string; timestamp: number }
  | { type: 'run_done';            runId: string; finalOutput: string; durationMs: number; timestamp: number }
  | { type: 'run_error';           runId: string; error: string; timestamp: number }
  | { type: 'run_aborted';         runId: string; timestamp: number };

// ── Workflow step (sequential or parallel) ────────────────────────────────────

export interface WorkflowStep {
  agentId?: string;
  input: string;
  output?: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted';
  contextMode: 'full' | 'summary' | 'none';
  skipped?: boolean;
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

// ── Re-exports from lib/ (single import surface for consumers) ────────────────
export type { ParallelRunnerDeps } from '../lib/parallelRunner';
