/**
 * parallelRunner.ts
 * Fan-out / fan-in engine for parallel agent execution.
 *
 * A workflow.md step with `mode: parallel` dispatches to multiple agents
 * concurrently via Promise.allSettled, then merges results according to
 * the step's `merge_strategy` before handing off to the next sequential step.
 *
 * Merge strategies
 * ─────────────────
 *  concat     Append results in declaration order (default)
 *  summarise  Route merged text through a dedicated summariser agent
 *  vote       Majority-vote on structured { choice, reason } JSON outputs
 *
 * Abort propagation
 * ─────────────────
 * The caller passes a shared AbortSignal. When aborted, all in-flight agent
 * calls are cancelled via their own per-call AbortController children derived
 * from the parent signal. Failed / aborted agents are logged but do not block
 * the fan-in — the merge receives whatever succeeded.
 */

import type { AgentMeta } from './agentFs';
import type { WorkflowStep, RunEvent } from './workflowRunner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeStrategy = 'concat' | 'summarise' | 'vote';

export interface ParallelStep {
  /** Agent folder names to run concurrently */
  agents: string[];
  mode: 'parallel';
  merge_strategy?: MergeStrategy;
  /** Agent folder name to use for the "summarise" strategy */
  summariser_agent?: string;
}

export interface AgentResult {
  agentId: string;
  output: string;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  status: 'done' | 'error' | 'aborted';
  error?: string;
}

export interface ParallelRunResult {
  /** Merged text ready to be passed as context to the next sequential step */
  mergedOutput: string;
  results: AgentResult[];
  /** True if at least one agent succeeded */
  anySucceeded: boolean;
}

// ---------------------------------------------------------------------------
// Dependencies injected by the caller to avoid circular imports
// ---------------------------------------------------------------------------

export interface ParallelRunnerDeps {
  /**
   * Run a single agent and return its full text output.
   * This is the same function used by the sequential runner —
   * the parallel runner reuses it without modification.
   */
  runSingleAgent: (
    agentId: string,
    inputContext: string,
    signal: AbortSignal,
    onChunk: (chunk: string) => void,
  ) => Promise<string>;

  /**
   * Emit a RunEvent into the shared event bus so the UI (ChatPanel,
   * WorkflowGraph) can reflect parallel progress in real time.
   */
  emitEvent: (event: RunEvent) => void;

  /**
   * Resolve an agent ID to its parsed AgentMeta, used by the
   * "summarise" strategy to locate the summariser agent.
   */
  getAgentMeta: (agentId: string) => AgentMeta | undefined;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a parallel step: fan out to all agents, collect results, merge.
 *
 * @param step          - The parallel workflow step definition
 * @param inputContext  - Context string forwarded to every agent in the group
 * @param signal        - Parent AbortSignal (shared across the whole run)
 * @param deps          - Injected runner functions
 * @param runId         - Current run ID (for event correlation)
 */
export async function runParallelStep(
  step: ParallelStep,
  inputContext: string,
  signal: AbortSignal,
  deps: ParallelRunnerDeps,
  runId: string,
): Promise<ParallelRunResult> {
  const strategy: MergeStrategy = step.merge_strategy ?? 'concat';

  // ------------------------------------------------------------------
  // Fan-out: dispatch all agents concurrently
  // ------------------------------------------------------------------
  const promises = step.agents.map((agentId) =>
    runOneAgent(agentId, inputContext, signal, deps, runId),
  );

  const settled = await Promise.allSettled(promises);

  const results: AgentResult[] = settled.map((outcome, i) => {
    const agentId = step.agents[i];
    if (outcome.status === 'fulfilled') return outcome.value;
    // Rejected means an unexpected throw (not a normal abort/error,
    // those are handled inside runOneAgent).
    return {
      agentId,
      output: '',
      durationMs: 0,
      status: 'error' as const,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });

  const succeeded = results.filter((r) => r.status === 'done');
  const anySucceeded = succeeded.length > 0;

  // ------------------------------------------------------------------
  // Fan-in: merge results
  // ------------------------------------------------------------------
  const mergedOutput = await mergeResults(results, strategy, inputContext, signal, deps, runId);

  // Emit a synthetic "parallel group done" event for the graph.
  deps.emitEvent({
    type: 'parallel_group_done',
    runId,
    agentIds: step.agents,
    succeededCount: succeeded.length,
    totalCount: step.agents.length,
    mergedOutput,
    timestamp: Date.now(),
  });

  return { mergedOutput, results, anySucceeded };
}

// ---------------------------------------------------------------------------
// Run a single agent inside the parallel group
// ---------------------------------------------------------------------------

async function runOneAgent(
  agentId: string,
  inputContext: string,
  parentSignal: AbortSignal,
  deps: ParallelRunnerDeps,
  runId: string,
): Promise<AgentResult> {
  const start = Date.now();

  // Each agent gets its own AbortController so we can see which one
  // was aborted vs which finished normally.
  const ctl = new AbortController();
  const onParentAbort = () => ctl.abort();
  parentSignal.addEventListener('abort', onParentAbort, { once: true });

  // Emit "agent started" for the graph node.
  deps.emitEvent({
    type: 'agent_start',
    runId,
    agentId,
    timestamp: Date.now(),
  });

  let output = '';

  try {
    output = await deps.runSingleAgent(
      agentId,
      inputContext,
      ctl.signal,
      (chunk) => {
        // Forward streaming chunks as events so the ChatPanel can render
        // parallel agent streams side-by-side.
        deps.emitEvent({
          type: 'agent_chunk',
          runId,
          agentId,
          chunk,
          timestamp: Date.now(),
        });
      },
    );

    deps.emitEvent({
      type: 'agent_done',
      runId,
      agentId,
      output,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    });

    return { agentId, output, durationMs: Date.now() - start, status: 'done' };
  } catch (err) {
    const isAbort =
      ctl.signal.aborted ||
      (err instanceof Error && err.name === 'AbortError');

    const status = isAbort ? 'aborted' : 'error';
    const errorMsg = err instanceof Error ? err.message : String(err);

    deps.emitEvent({
      type: 'agent_error',
      runId,
      agentId,
      error: errorMsg,
      status,
      timestamp: Date.now(),
    });

    return {
      agentId,
      output: '',
      durationMs: Date.now() - start,
      status,
      error: errorMsg,
    };
  } finally {
    parentSignal.removeEventListener('abort', onParentAbort);
  }
}

// ---------------------------------------------------------------------------
// Merge strategies
// ---------------------------------------------------------------------------

async function mergeResults(
  results: AgentResult[],
  strategy: MergeStrategy,
  inputContext: string,
  signal: AbortSignal,
  deps: ParallelRunnerDeps,
  runId: string,
): Promise<string> {
  const succeeded = results.filter((r) => r.status === 'done' && r.output.trim());

  if (succeeded.length === 0) return '';

  switch (strategy) {
    // ── concat ──────────────────────────────────────────────────────────────
    case 'concat': {
      return succeeded
        .map((r) => `## ${r.agentId}\n\n${r.output.trim()}`)
        .join('\n\n---\n\n');
    }

    // ── summarise ───────────────────────────────────────────────────────────
    case 'summarise': {
      const combined = succeeded
        .map((r) => `### ${r.agentId}\n${r.output.trim()}`)
        .join('\n\n');

      const summariserPrompt =
        `The following outputs were produced by parallel agents working on the same task.\n` +
        `Synthesise them into a single coherent response that preserves all important information.\n\n` +
        `Original task context:\n${inputContext}\n\n` +
        `Agent outputs:\n${combined}`;

      // Use the dedicated summariser agent if available, otherwise fall back
      // to a plain runSingleAgent call with a generic summariser persona.
      try {
        const summarisedOutput = await deps.runSingleAgent(
          'summarizer',
          summariserPrompt,
          signal,
          () => {},
        );
        return summarisedOutput;
      } catch {
        // If the summariser is unavailable, fall back to concat.
        return succeeded
          .map((r) => `## ${r.agentId}\n\n${r.output.trim()}`)
          .join('\n\n---\n\n');
      }
    }

    // ── vote ────────────────────────────────────────────────────────────────
    case 'vote': {
      // Expect each agent output to be JSON: { choice: string, reason: string }
      const votes: Record<string, number> = {};
      const reasons: Record<string, string[]> = {};

      for (const r of succeeded) {
        try {
          // Strip markdown code fences if present.
          const clean = r.output.replace(/^```(?:json)?\n?|\n?```$/gm, '').trim();
          const parsed = JSON.parse(clean) as { choice: string; reason?: string };
          const choice = String(parsed.choice).trim();
          votes[choice] = (votes[choice] ?? 0) + 1;
          reasons[choice] = [...(reasons[choice] ?? []), parsed.reason ?? ''];
        } catch {
          // Non-JSON output: skip this vote
        }
      }

      if (Object.keys(votes).length === 0) {
        // No valid votes parsed — fall back to concat
        return succeeded
          .map((r) => `## ${r.agentId}\n\n${r.output.trim()}`)
          .join('\n\n---\n\n');
      }

      const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      const winnerReasons = reasons[winner] ?? [];
      const voteCount = votes[winner];
      const totalVotes = succeeded.length;

      return (
        `**Decision:** ${winner}\n` +
        `**Votes:** ${voteCount} / ${totalVotes}\n\n` +
        `**Reasons:**\n${winnerReasons.map((r) => `- ${r}`).join('\n')}`
      );
    }
  }
}
