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
 *
 * RunEvent is the canonical type in src/types/index.ts.
 */

import matter from 'gray-matter';
import type { AgentMeta } from './agentFs';
import { runParallelStep } from './parallelRunner';
import { evaluateCondition } from './workflowParser';
import type {
  RunEvent,
  ParallelGroupStep,
  ParallelRunnerDeps,
} from '../types';

// ---------------------------------------------------------------------------
// Types (local to workflowRunner)
// ---------------------------------------------------------------------------

export type ContextMode = 'full' | 'summary' | 'none';

/** Per-step model/temperature overrides forwarded to the chat call. */
export interface StepOverrides {
  model?: string;
  temperature?: number;
}

/** Shape of one step as parsed from workflow.md frontmatter. */
interface WorkflowStepDef {
  agent?: string;
  agents?: string[];
  mode?: 'sequential' | 'parallel';
  merge_strategy?: 'concat' | 'summarise' | 'vote';
  timeout_ms?: number;
  // Per-step sequential overrides (parsed but previously ignored at runtime).
  prompt_override?: string;
  model?: string;
  temperature?: number;
  context_mode?: ContextMode;
  condition?: string;
}

interface WorkflowDef {
  steps: WorkflowStepDef[];
  /** What to do when a sequential step errors out. Default: "stop". */
  onError: 'stop' | 'continue' | 'retry';
  /** Retry budget when onError is "retry". Default: 1. */
  maxRetries: number;
}

export interface WorkflowRunnerDeps {
  /**
   * Run a single agent against Ollama and return the full response text.
   * Injected so both sequential and parallel paths use the same impl.
   *
   * `overrides` lets a workflow.md step override the agent's model/temperature.
   */
  runSingleAgent: (
    agentId: string,
    inputContext: string,
    signal: AbortSignal,
    onChunk: (chunk: string) => void,
    overrides?: StepOverrides,
  ) => Promise<string>;

  /** Emit a typed run event to all subscribers. */
  emitEvent: (event: RunEvent) => void;

  /** Resolve agent ID → AgentMeta (for context_mode + model). */
  getAgentMeta: (agentId: string) => AgentMeta | undefined;

  /** Read a raw file from an agent folder (used to load workflow.md). */
  readAgentFile: (agentId: string, filename: string) => Promise<string | null>;
}

// Re-export so callers can import RunEvent from here if preferred
export type { RunEvent };

// ---------------------------------------------------------------------------
// Context budget
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
// workflow.md parser
// ---------------------------------------------------------------------------

function parseWorkflowDef(raw: string): WorkflowDef {
  const { data } = matter(raw);
  const steps: WorkflowStepDef[] = Array.isArray(data.steps) ? data.steps : [];
  const onError: WorkflowDef['onError'] =
    data.on_error === 'continue' || data.on_error === 'retry'
      ? data.on_error
      : 'stop';
  const maxRetries =
    typeof data.max_retries === 'number' && data.max_retries >= 0
      ? Math.floor(data.max_retries)
      : 1;
  return { steps, onError, maxRetries };
}

/** Replace {{input}} / {{previous}} placeholders in a prompt_override template. */
function interpolate(
  template: string,
  vars: { input: string; previous: string },
): string {
  return template
    .replace(/\{\{\s*input\s*\}\}/g, vars.input)
    .replace(/\{\{\s*previous\s*\}\}/g, vars.previous);
}

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === 'AbortError');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Execute a full workflow starting from `entryAgentId`.
 *
 * If the entry agent has a `workflow.md`, that definition drives execution
 * (static mode). Otherwise the runner follows `next_agents` frontmatter
 * links until the chain ends (dynamic mode).
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
    const workflowRaw = await deps.readAgentFile(entryAgentId, 'workflow.md');
    if (workflowRaw) {
      return await runFromWorkflowDef(
        parseWorkflowDef(workflowRaw),
        prompt, signal, deps, runId, runStart,
      );
    }
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
// Static: workflow.md-driven execution
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
  let stepCount = 0;

  // Build deps for parallelRunner — injects same runSingleAgent impl
  const parallelDeps: ParallelRunnerDeps = {
    runSingleAgent: deps.runSingleAgent,
    emitEvent:      deps.emitEvent,
    getAgentMeta:   deps.getAgentMeta,
  };

  for (const step of def.steps) {
    if (signal.aborted) break;

    // ── Parallel branch ───────────────────────────────────────────────────
    if (step.mode === 'parallel' && step.agents?.length) {
      const parallelStep: ParallelGroupStep = {
        agents:         step.agents,
        mode:           'parallel',
        merge_strategy: step.merge_strategy,
        timeout_ms:     step.timeout_ms,
      };
      const result = await runParallelStep(parallelStep, context, signal, parallelDeps, runId);
      // Only update context if at least one agent succeeded
      if (result.anySucceeded) context = result.merged;
      stepCount++;
      continue;
    }

    // ── Sequential branch ──────────────────────────────────────────────
    if (step.agent) {
      // Condition gate — skip the step when the condition evaluates to false.
      if (!evaluateCondition(step.condition, { previousOutput: context, stepCount })) {
        console.debug(
          `[workflowRunner] Step '${step.agent}' skipped — condition not met: ${step.condition}`,
        );
        continue;
      }

      context = await runSequentialStepWithRetry(
        step.agent,
        context,
        prompt,
        signal,
        deps,
        runId,
        {
          contextMode:    step.context_mode,
          promptOverride: step.prompt_override,
          overrides:      { model: step.model, temperature: step.temperature },
        },
        def.onError,
        def.maxRetries,
      );
      stepCount++;
    }
  }

  deps.emitEvent({
    type: 'run_done',
    runId,
    finalOutput: context,
    durationMs: Date.now() - runStart,
    timestamp: Date.now(),
  });
  return context;
}

// ---------------------------------------------------------------------------
// Dynamic: next_agents chaining
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

    const meta = deps.getAgentMeta(currentAgentId);
    // next_agents[0] = sequential next; multiple entries = use workflow.md instead
    currentAgentId = meta?.nextAgents?.[0];
  }

  deps.emitEvent({
    type: 'run_done',
    runId,
    finalOutput: context,
    durationMs: Date.now() - runStart,
    timestamp: Date.now(),
  });
  return context;
}

// ---------------------------------------------------------------------------
// Single sequential step
// ---------------------------------------------------------------------------

interface SequentialStepOptions {
  /** Step-level context_mode override (falls back to the agent's own). */
  contextMode?: ContextMode;
  /** Raw prompt_override template ({{input}}/{{previous}} interpolated here). */
  promptOverride?: string;
  /** Per-step model/temperature overrides forwarded to runSingleAgent. */
  overrides?: StepOverrides;
}

/**
 * Run a sequential step, honouring `onError`:
 *   stop     → rethrow (run fails)
 *   continue → log and keep the previous context (skip this step's output)
 *   retry    → retry up to maxRetries, then fall back to "stop"
 * Aborts are never retried and always propagate.
 */
async function runSequentialStepWithRetry(
  agentId: string,
  context: string,
  originalPrompt: string,
  signal: AbortSignal,
  deps: WorkflowRunnerDeps,
  runId: string,
  opts: SequentialStepOptions,
  onError: WorkflowDef['onError'],
  maxRetries: number,
): Promise<string> {
  let attempt = 0;
  while (true) {
    try {
      return await runSequentialStep(agentId, context, originalPrompt, signal, deps, runId, opts);
    } catch (err) {
      if (isAbort(signal, err)) throw err;

      if (onError === 'retry' && attempt < maxRetries) {
        attempt++;
        console.warn(`[workflowRunner] Step '${agentId}' failed — retry ${attempt}/${maxRetries}`);
        continue;
      }
      if (onError === 'continue') {
        console.warn(`[workflowRunner] Step '${agentId}' failed — continuing with previous context`);
        return context;
      }
      throw err; // "stop" (and exhausted retries)
    }
  }
}

async function runSequentialStep(
  agentId: string,
  context: string,
  originalPrompt: string,
  signal: AbortSignal,
  deps: WorkflowRunnerDeps,
  runId: string,
  opts: SequentialStepOptions = {},
): Promise<string> {
  const meta = deps.getAgentMeta(agentId);

  // prompt_override (if present) replaces the budgeted context entirely.
  let agentInput: string;
  if (opts.promptOverride !== undefined) {
    agentInput = interpolate(opts.promptOverride, {
      input: originalPrompt,
      previous: context,
    });
  } else {
    const contextMode: ContextMode =
      opts.contextMode ?? (meta?.contextMode as ContextMode) ?? 'summary';
    agentInput = applyContextBudget(context, contextMode, originalPrompt);
  }

  deps.emitEvent({ type: 'agent_start', runId, agentId, timestamp: Date.now() });

  const start = Date.now();

  try {
    const output = await deps.runSingleAgent(
      agentId,
      agentInput,
      signal,
      (chunk) => deps.emitEvent({ type: 'agent_chunk', runId, agentId, chunk, timestamp: Date.now() }),
      opts.overrides,
    );

    deps.emitEvent({
      type: 'agent_done',
      runId, agentId, output,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    });

    return output;
  } catch (err) {
    deps.emitEvent({
      type: 'agent_error',
      runId, agentId,
      error: err instanceof Error ? err.message : String(err),
      status: isAbort(signal, err) ? 'aborted' : 'error',
      timestamp: Date.now(),
    });
    throw err;
  }
}
