/**
 * parallelRunner.ts
 *
 * Fan-out / fan-in parallel agent execution engine.
 *
 * Called by workflowRunner when a workflow.md step has `mode: parallel`.
 * All listed agents receive the same (budgeted) input context and run
 * concurrently via Promise.allSettled. Results are merged according to
 * the step's merge_strategy before being returned to workflowRunner.
 *
 * Merge strategies
 * ────────────────
 * concat     Outputs appended in declaration order (default)
 * summarise  LLM call condenses all results into one synthesis
 * vote       Agents return { choice, reason } JSON; majority wins
 *
 * No circular imports: this file never imports from workflowRunner.
 * Ollama is accessed only via the injected deps.runSingleAgent.
 */

import type {
  AgentResult,
  MergeStrategy,
  ParallelGroupStep,
  ParallelRunResult,
  RunEvent,
} from '../types';
import type { AgentMeta } from './agentFs';
import { ollamaChat } from './ollama';

export type { AgentResult, MergeStrategy, ParallelGroupStep, ParallelRunResult };

// ---------------------------------------------------------------------------
// Injected dependencies (provided by workflowRunner)
// ---------------------------------------------------------------------------

export interface ParallelRunnerDeps {
  runSingleAgent: (
    agentId: string,
    inputContext: string,
    signal: AbortSignal,
    onChunk: (chunk: string) => void,
  ) => Promise<string>;
  emitEvent:    (event: RunEvent) => void;
  getAgentMeta: (agentId: string) => AgentMeta | undefined;
}

// ---------------------------------------------------------------------------
// Token budget (4 chars ≈ 1 token)
// ---------------------------------------------------------------------------

function budgetContext(context: string, maxTokens = 2048): string {
  const charLimit = maxTokens * 4;
  if (context.length <= charLimit) return context;
  return '…[context trimmed]\n' + context.slice(-charLimit);
}

// ---------------------------------------------------------------------------
// Run one agent inside a parallel group
// ---------------------------------------------------------------------------

async function runAgentInGroup(
  agentId: string,
  meta: AgentMeta,
  inputContext: string,
  signal: AbortSignal,
  timeoutMs: number,
  deps: ParallelRunnerDeps,
  runId: string,
): Promise<AgentResult> {
  const start = performance.now();

  const timeoutCtrl = new AbortController();
  const timeoutId   = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const combined    = typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeoutCtrl.signal])
    : signal;

  const budgeted = budgetContext(inputContext, meta.maxTokens ?? 2048);

  deps.emitEvent({ type: 'agent_start', runId, agentId, timestamp: Date.now() });

  try {
    const output = await deps.runSingleAgent(
      agentId,
      budgeted,
      combined,
      (chunk) => deps.emitEvent({ type: 'agent_chunk', runId, agentId, chunk, timestamp: Date.now() }),
    );

    clearTimeout(timeoutId);
    const durationMs = Math.round(performance.now() - start);
    deps.emitEvent({ type: 'agent_done', runId, agentId, output, durationMs, timestamp: Date.now() });
    return { agentId, output, durationMs, status: 'ok' };

  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = Math.round(performance.now() - start);
    const isTimeout  = timeoutCtrl.signal.aborted;
    const isAbort    = !isTimeout && signal.aborted;
    const status: AgentResult['status'] = isTimeout ? 'timeout' : isAbort ? 'aborted' : 'error';
    const error = isTimeout
      ? `Timed out after ${timeoutMs}ms`
      : err instanceof Error ? err.message : String(err);

    deps.emitEvent({
      type: 'agent_error', runId, agentId, error,
      status: isAbort ? 'aborted' : 'error',
      timestamp: Date.now(),
    });
    return { agentId, output: '', durationMs, status, error };
  }
}

// ---------------------------------------------------------------------------
// Merge strategies
// ---------------------------------------------------------------------------

function mergeConcat(results: AgentResult[]): string {
  return results
    .filter((r) => r.status === 'ok' && r.output)
    .map((r)   => `### ${r.agentId}\n\n${r.output}`)
    .join('\n\n---\n\n');
}

async function mergeSummarise(
  results: AgentResult[],
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const combined = mergeConcat(results);
  if (!combined) return '';
  return ollamaChat(
    {
      model,
      messages: [
        { role: 'system', content: 'You are a precise synthesis assistant.' },
        { role: 'user',   content:
          'The following outputs were produced by multiple agents working in parallel.\n' +
          'Synthesise them into a single coherent summary, preserving all important details.\n' +
          'Output only the synthesis.\n\n' + combined,
        },
      ],
      options: { temperature: 0.3, num_predict: 1024 },
    },
    signal,
  );
}

function mergeVote(results: AgentResult[]): string {
  interface VotePayload { choice: string; reason: string; }
  const votes: Array<{ agentId: string } & VotePayload> = [];

  for (const r of results) {
    if (r.status !== 'ok' || !r.output) continue;
    try {
      const raw    = r.output.replace(/^```[\w]*\n?/m, '').replace(/```$/m, '').trim();
      const parsed = JSON.parse(raw) as VotePayload;
      votes.push({ agentId: r.agentId, ...parsed });
    } catch {
      votes.push({ agentId: r.agentId, choice: r.output.trim(), reason: '' });
    }
  }

  if (!votes.length) return '';

  const tally = new Map<string, { count: number; reasons: string[] }>();
  for (const v of votes) {
    const key   = v.choice.toLowerCase().trim();
    const entry = tally.get(key) ?? { count: 0, reasons: [] };
    entry.count++;
    if (v.reason) entry.reasons.push(`${v.agentId}: ${v.reason}`);
    tally.set(key, entry);
  }

  const [winnerKey, winnerData] = [...tally.entries()]
    .sort((a, b) => b[1].count - a[1].count)[0];
  const winnerChoice = votes.find(
    (v) => v.choice.toLowerCase().trim() === winnerKey,
  )?.choice ?? winnerKey;

  const lines = [`**Vote result:** ${winnerChoice} (${winnerData.count}/${votes.length} votes)`];
  if (winnerData.reasons.length)
    lines.push('', '**Reasons:**', ...winnerData.reasons.map((r) => `- ${r}`));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point — called by workflowRunner
// ---------------------------------------------------------------------------

export async function runParallelStep(
  step: ParallelGroupStep,
  inputContext: string,
  signal: AbortSignal,
  deps: ParallelRunnerDeps,
  runId: string,
): Promise<ParallelRunResult> {
  const wallStart  = performance.now();
  const strategy   = step.merge_strategy ?? 'concat';
  const timeoutMs  = step.timeout_ms     ?? 120_000;

  // Fan-out
  const tasks = step.agents.map((agentId) => {
    const meta = deps.getAgentMeta(agentId);
    if (!meta) {
      return Promise.resolve<AgentResult>({
        agentId, output: '', durationMs: 0,
        status: 'error',
        error: `Agent "${agentId}" not found in registry`,
      });
    }
    return runAgentInGroup(agentId, meta, inputContext, signal, timeoutMs, deps, runId);
  });

  // Fan-in
  const settled = await Promise.allSettled(tasks);
  const results: AgentResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          agentId: step.agents[i], output: '', durationMs: 0,
          status: 'error' as const,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        },
  );

  const succeededCount = results.filter((r) => r.status === 'ok').length;
  const anySucceeded   = succeededCount > 0;

  // Merge
  let merged: string;
  if (signal.aborted) {
    merged = mergeConcat(results);
  } else {
    switch (strategy) {
      case 'summarise': {
        const model =
          deps.getAgentMeta(results.find((r) => r.status === 'ok')?.agentId ?? '')?.model
          ?? 'llama3.2:3b';
        merged = await mergeSummarise(results, model, signal);
        break;
      }
      case 'vote':  merged = mergeVote(results);   break;
      default:      merged = mergeConcat(results);  break;
    }
  }

  const totalDurationMs = Math.round(performance.now() - wallStart);

  deps.emitEvent({
    type: 'parallel_group_done',
    runId,
    agentIds:       step.agents,
    succeededCount,
    totalCount:     step.agents.length,
    mergedOutput:   merged,
    timestamp:      Date.now(),
  });

  return { merged, results, strategy, totalDurationMs, anySucceeded };
}

// ---------------------------------------------------------------------------
// Chat-panel summary formatter
// ---------------------------------------------------------------------------

export function formatParallelSummary(result: ParallelRunResult): string {
  const ok    = result.results.filter((r) => r.status === 'ok').length;
  const total = result.results.length;
  return [
    `**Parallel group** — ${ok}/${total} agents succeeded · merge: \`${result.strategy}\` · ${result.totalDurationMs}ms`,
    '',
    ...result.results.map((r) => {
      const icon   = r.status === 'ok' ? '✅' : r.status === 'timeout' ? '⏱' : r.status === 'aborted' ? '⛔' : '❌';
      const detail = r.status !== 'ok' && r.error ? ` — ${r.error}` : ` — ${r.durationMs}ms`;
      return `${icon} **${r.agentId}**${detail}`;
    }),
  ].join('\n');
}
