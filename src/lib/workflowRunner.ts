/**
 * workflowRunner.ts
 * Sequential workflow execution engine.
 *
 * Parses workflow.md steps, dispatches sequential steps one by one,
 * and delegates parallel steps to parallelRunner.ts.
 *
 * Context budget
 * ──────────────
 * Each agent's context_mode controls what is forwarded:
 *   full     → full output of previous step
 *   summary  → first 1200 chars + "…[truncated]"
 *   none     → only the original user prompt
 *
 * Event bus
 * ─────────
 * The runner emits typed RunEvents through the emitEvent callback.
 * Consumers (ChatPanel, WorkflowGraph, useHistoryStore) subscribe
 * independently — no tight coupling.
 */

import matter from 'gray-matter';
import type { AgentMeta } from './agentFs';
import { runParallelStep, type ParallelStep, type ParallelRunnerDeps } from './parallelRunner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextMode = 'full' | 'summary' | 'none';

export interface WorkflowStep {
  /** Sequential: single agent */
  agent?: string;
  /** Parallel group */
  agents?: string[];
  mode?: 'sequential' | 'parallel';
  merge_strategy?: 'concat' | 'summarise' | 'vote';
}

export interface WorkflowDef {
  steps: WorkflowStep[];
}

/** All event types emitted during a run */
export type RunEvent =
  | { type: 'run_start';            runId: string; prompt: string; timestamp: number }
  | { type: 'agent_start';          runId: string; agentId: string; timestamp: number }
  | { type: 'agent_chunk';          runId: string; agentId: string; chunk: string; timestamp: number }
  | { type: 'agent_done';           runId: string; agentId: string; output: string; durationMs: number; timestamp: number }
  | { type: 'agent_error';          runId: string; agentId: string; error: string; status: 'error' | 'aborted'; timestamp: number }
  | { type: 'parallel_group_done';  runId: string; agentIds: string[]; succeededCount: number; totalCount: number; mergedOutput: string; timestamp: number }
  | { type: 'run_done';             runId: string; finalOutput: string; durationMs: number; timestamp: number }
  | { type: 'run_error';            runId: string; error: string; timestamp: number }
  | { type: 'run_aborted';          runId: string; timestamp: number };

export interface WorkflowRunnerDeps {
  /** Run a single agent against Ollama and return the full response text. */
  runSingleAgent: (
    agentId: string,
    inputContext: string,
    signal: AbortSignal,
    onChunk: (chunk: string) => void,
  ) => Promise<string>;

  /** Emit an event to all subscribers. */
  emitEvent: (event: RunEvent) => void;

  /** Resolve agent ID to AgentMeta (for context_mode + model resolution). */
  getAgentMeta: (agentId: string) => AgentMeta | undefined;

  /** Read a file from the agent folder (for workflow.md parsing). */
  readAgentFile: (agentId: string, filename: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Context budget helper
// ---------------------------------------------------------------------------

const SUMMARY_LIMIT = 1200;

function applyContextBudget(
  output: string,
  mode: ContextMode,
  originalPrompt: string,
): string {
  switch (mode) {
    case 'full':    return output;
    case 'none':    return originalPrompt;
    case 'summary':
    default:
      return output.length <= SUMMARY_LIMIT
        ? output
        : output.slice(0, SUMMARY_LIMIT) + '\n…[truncated — full output available in run history]';
  }
}

// ---------------------------------------------------------------------------
// Workflow definition parser
// ---------------------------------------------------------------------------

function parseWorkflowDef(raw: string): WorkflowDef {
  const { data } = matter(raw);
  const steps: WorkflowStep[] = Array.isArray(data.steps) ? data.steps : [];
  return { steps };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Execute a full workflow starting from `entryAgentId`.
 *
 * If the entry agent has a `workflow.md`, that definition overrides the
 * dynamic `next_agents` chain. Otherwise the runner follows `next_agents`
 * frontmatter links sequentially until no next agent is defined.
 *
 * @param entryAgentId  - The first agent to activate (usually "router")
 * @param prompt        - The original user prompt
 * @param signal        - AbortSignal for the entire run
 * @param deps          - Injected functions (avoids circular deps)
 * @param runId         - Unique ID for this run
 */
export async function runWorkflow(
  entryAgentId: string,
  prompt: string,
  signal: AbortSignal,
  deps: WorkflowRunnerDeps,
  runId: string,
): Promise<string> {
  const runStart = Date.now();

  deps.emitEvent({ type: 'run_start', runId, prompt, timestamp: Date.now() });

  try {
    // ── Check for explicit workflow.md ──────────────────────────────────────
    const workflowRaw = await deps.readAgentFile(entryAgentId, 'workflow.md');
    if (workflowRaw) {
      return await runFromWorkflowDef(
        parseWorkflowDef(workflowRaw),
        prompt,
        signal,
        deps,
        runId,
        runStart,
      );
    }

    // ── Dynamic chaining via next_agents ────────────────────────────────────
    return await runDynamic(entryAgentId, prompt, signal, deps, runId, runStart);
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      deps.emitEvent({ type: 'run_aborted', runId, timestamp: Date.now() });
      return '';
    }
    const msg = err instanceof Error ? err.message : String(err);
    deps.emitEvent({ type: 'run_error', runId, error: msg, timestamp: Date.now() });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Workflow.md-driven execution
// ---------------------------------------------------------------------------

async function runFromWorkflowDef(
  def: WorkflowDef,
  prompt: string,
  signal: AbortSignal,
  deps: WorkflowRunnerDeps,
  runId: string,
  runStart: number,
): Promise<string> {
  let context = prompt;

  const parallelDeps: ParallelRunnerDeps = {
    runSingleAgent: deps.runSingleAgent,
    emitEvent: deps.emitEvent,
    getAgentMeta: deps.getAgentMeta,
  };

  for (const step of def.steps) {
    if (signal.aborted) break;

    // Parallel step
    if (step.mode === 'parallel' && step.agents?.length) {
      const result = await runParallelStep(
        step as ParallelStep,
        context,
        signal,
        parallelDeps,
        runId,
      );
      if (result.anySucceeded) context = result.mergedOutput;
      continue;
    }

    // Sequential step
    if (step.agent) {
      context = await runSequentialStep(step.agent, context, prompt, signal, deps, runId);
    }
  }

  const finalOutput = context;
  deps.emitEvent({
    type: 'run_done',
    runId,
    finalOutput,
    durationMs: Date.now() - runStart,
    timestamp: Date.now(),
  });
  return finalOutput;
}

// ---------------------------------------------------------------------------
// Dynamic next_agents chaining
// ---------------------------------------------------------------------------

async function runDynamic(
  entryAgentId: string,
  prompt: string,
  signal: AbortSignal,
  deps: WorkflowRunnerDeps,
  runId: string,
  runStart: number,
): Promise<string> {
  let currentAgentId: string | undefined = entryAgentId;
  let context = prompt;
  const visited = new Set<string>();

  while (currentAgentId && !signal.aborted) {
    if (visited.has(currentAgentId)) break; // cycle guard
    visited.add(currentAgentId);

    context = await runSequentialStep(currentAgentId, context, prompt, signal, deps, runId);

    // Determine next agent from frontmatter
    const meta = deps.getAgentMeta(currentAgentId);
    const nextAgents = meta?.nextAgents ?? [];
    // Take the first next agent (multi-branch = parallel, handled via workflow.md)
    currentAgentId = nextAgents[0];
  }

  const finalOutput = context;
  deps.emitEvent({
    type: 'run_done',
    runId,
    finalOutput,
    durationMs: Date.now() - runStart,
    timestamp: Date.now(),
  });
  return finalOutput;
}

// ---------------------------------------------------------------------------
// Run one sequential agent step
// ---------------------------------------------------------------------------

async function runSequentialStep(
  agentId: string,
  context: string,
  originalPrompt: string,
  signal: AbortSignal,
  deps: WorkflowRunnerDeps,
  runId: string,
): Promise<string> {
  const meta = deps.getAgentMeta(agentId);
  const contextMode: ContextMode = (meta?.contextMode as ContextMode) ?? 'summary';
  const budgetedContext = applyContextBudget(context, contextMode, originalPrompt);

  deps.emitEvent({ type: 'agent_start', runId, agentId, timestamp: Date.now() });

  const start = Date.now();
  let output = '';

  try {
    output = await deps.runSingleAgent(
      agentId,
      budgetedContext,
      signal,
      (chunk) =>
        deps.emitEvent({ type: 'agent_chunk', runId, agentId, chunk, timestamp: Date.now() }),
    );
  } catch (err) {
    const isAbort = signal.aborted || (err instanceof Error && err.name === 'AbortError');
    deps.emitEvent({
      type: 'agent_error',
      runId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
      status: isAbort ? 'aborted' : 'error',
      timestamp: Date.now(),
    });
    throw err;
  }

  deps.emitEvent({
    type: 'agent_done',
    runId,
    agentId,
    output,
    durationMs: Date.now() - start,
    timestamp: Date.now(),
  });

  return output;
}
