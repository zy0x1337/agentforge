/**
 * parallelRunner.ts
 *
 * Fan-out / fan-in parallel agent execution engine.
 *
 * A workflow.md step with `mode: parallel` activates this runner.
 * All listed agents receive the same input context and execute
 * concurrently via Promise.allSettled. Results are merged according
 * to the step's `merge_strategy` before being passed to the next
 * sequential step.
 *
 * Merge strategies
 * ────────────────
 * concat     Raw outputs appended in declaration order (default)
 * summarise  A lightweight summariser prompt condenses all results
 * vote       Structured { choice, reason } outputs; majority wins
 *
 * Integration surface
 * ───────────────────
 * workflowRunner calls runParallelStep() and passes ParallelRunnerDeps.
 * All shared types are canonical in src/types/index.ts and re-exported here
 * for convenience.
 */

import type { AgentMeta } from './agentFs';
import type {
  AgentResult,
  MergeStrategy,
  ParallelGroupStep,
  ParallelRunResult,
  RunEvent,
} from '../types';
import { ollamaChat, ollamaChatStream } from './ollama';
import { buildSystemPrompt } from './workflowRunner';

export type { AgentResult, MergeStrategy, ParallelGroupStep, ParallelRunResult };

// ---------------------------------------------------------------------------
// Deps injected by workflowRunner (avoids circular imports)
// ---------------------------------------------------------------------------

export interface ParallelRunnerDeps {
  /**
   * Run a single agent and return its full response.
   * workflowRunner injects its own runSingleAgent closure here so
   * parallelRunner never calls Ollama directly — testable by swapping deps.
   */
  runSingleAgent: (
    agentId: string,
    inputContext: string,
    signal: AbortSignal,
    onChunk: (chunk: string) => void,
  ) => Promise<string>;

  emitEvent: (event: RunEvent) => void;
  getAgentMeta: (agentId: string) => AgentMeta | undefined;
}

// ---------------------------------------------------------------------------
// Token budget helper (rough estimate: 4 chars ≈ 1 token)
// ---------------------------------------------------------------------------

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Truncate context to fit within `maxTokens`.
 * Preserves the tail (most recent content) when trimming.
 */
function budgetContext(context: string, maxTokens = 2048): string {
  if (estimateTokens(context) <= maxTokens) return context;
  const charLimit = maxTokens * 4;
  return '…[context trimmed]\n' + context.slice(-charLimit);
}

// ---------------------------------------------------------------------------
// Single-agent execution inside a parallel group
// ---------------------------------------------------------------------------

async function runAgentInGroup(
  agentId: string,
  agentMeta: AgentMeta,
  inputContext: string,
  signal: AbortSignal,
  timeoutMs: number,
  deps: ParallelRunnerDeps,
  runId: string,
): Promise<AgentResult> {
  const start = performance.now();

  // Combine: abort when either the run signal or the per-agent timeout fires
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const combined = typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeoutCtrl.signal])
    : signal; // graceful fallback

  const budgeted = budgetContext(inputContext, agentMeta.maxTokens ?? 2048);

  deps.emitEvent({ type: 'agent_start', runId, agentId, timestamp: Date.now() });

  try {
    let output = '';
    output = await deps.runSingleAgent(
      agentId,
      budgeted,
      combined,
      (chunk) => {
        deps.emitEvent({ type: 'agent_chunk', runId, agentId, chunk, timestamp: Date.now() });
      },
    );

    clearTimeout(timeoutId);
    const durationMs = Math.round(performance.now() - start);

    deps.emitEvent({ type: 'agent_done', runId, agentId, output, durationMs, timestamp: Date.now() });

    return { agentId, output, durationMs, status: 'ok' };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = Math.round(performance.now() - start);

    const isTimeout = timeoutCtrl.signal.aborted;
    const isAbort   = !isTimeout && signal.aborted;
    const status: AgentResult['status'] = isTimeout ? 'timeout' : isAbort ? 'aborted' : 'error';
    const error = isTimeout
      ? `Timed out after ${timeoutMs}ms`
      : err instanceof Error ? err.message : String(err);

    deps.emitEvent({
      type: 'agent_error',
      runId,
      agentId,
      error,
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
    .map((r) => `### ${r.agentId}\n\n${r.output}`)
    .join('\n\n---\n\n');
}

async function mergeSummarise(
  results: AgentResult[],
  summaryModel: string,
  signal: AbortSignal,
): Promise<string> {
  const combined = mergeConcat(results);
  if (!combined) return '';
  const prompt = [
    'The following outputs were produced by multiple agents working in parallel.',
    'Synthesise them into a single coherent summary, preserving all important details.',
    'Do not add your own opinions. Output only the synthesis.\n\n',
    combined,
  ].join('\n');
  return ollamaChat(
    {
      model: summaryModel,
      messages: [
        { role: 'system', content: 'You are a precise synthesis assistant.' },
        { role: 'user', content: prompt },
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
      const raw = r.output.replace(/^```[\w]*\n?/m, '').replace(/```$/m, '').trim();
      const parsed = JSON.parse(raw) as VotePayload;
      votes.push({ agentId: r.agentId, ...parsed });
    } catch {
      votes.push({ agentId: r.agentId, choice: r.output.trim(), reason: '' });
    }
  }

  if (!votes.length) return '';

  const tally = new Map<string, { count: number; reasons: string[] }>();
  for (const v of votes) {
    const key = v.choice.toLowerCase().trim();
    const entry = tally.get(key) ?? { count: 0, reasons: [] };
    entry.count++;
    if (v.reason) entry.reasons.push(`${v.agentId}: ${v.reason}`);
    tally.set(key, entry);
  }

  const [winnerKey, winnerData] = [...tally.entries()]
    .sort((a, b) => b[1].count - a[1].count)[0];
  const winnerChoice =
    votes.find((v) => v.choice.toLowerCase().trim() === winnerKey)?.choice ?? winnerKey;

  const lines = [`**Vote result:** ${winnerChoice} (${winnerData.count}/${votes.length} votes)`];
  if (winnerData.reasons.length) {
    lines.push('', '**Reasons:**', ...winnerData.reasons.map((r) => `- ${r}`));
  }
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
  const start = performance.now();
  const strategy: MergeStrategy = step.merge_strategy ?? 'concat';
  const timeoutMs = step.timeout_ms ?? 120_000;

  // Fan-out: all agents start concurrently
  const tasks = step.agents.map((agentId) => {
    const meta = deps.getAgentMeta(agentId);
    if (!meta) {
      return Promise.resolve<AgentResult>({
        agentId,
        output: '',
        durationMs: 0,
        status: 'error',
        error: `Agent "${agentId}" not found in registry`,
      });
    }
    return runAgentInGroup(agentId, meta, inputContext, signal, timeoutMs, deps, runId);
  });

  // Fan-in: wait for all, even if some fail
  const settled = await Promise.allSettled(tasks);

  const results: AgentResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          agentId: step.agents[i],
          output: '',
          durationMs: 0,
          status: 'error' as const,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        },
  );

  const anySucceeded = results.some((r) => r.status === 'ok');
  const succeededCount = results.filter((r) => r.status === 'ok').length;

  // Merge
  let merged: string;
  if (signal.aborted) {
    merged = mergeConcat(results); // best-effort from what we got
  } else {
    switch (strategy) {
      case 'summarise': {
        const summaryModel =
          deps.getAgentMeta(
            results.find((r) => r.status === 'ok')?.agentId ?? '',
          )?.model ?? 'llama3.2:3b';
        merged = await mergeSummarise(results, summaryModel, signal);
        break;
      }
      case 'vote':
        merged = mergeVote(results);
        break;
      default:
        merged = mergeConcat(results);
    }
  }

  const totalDurationMs = Math.round(performance.now() - start);

  deps.emitEvent({
    type: 'parallel_group_done',
    runId,
    agentIds: step.agents,
    succeededCount,
    totalCount: step.agents.length,
    mergedOutput: merged,
    timestamp: Date.now(),
  });

  return { merged, results, strategy, totalDurationMs, anySucceeded };
}

// ---------------------------------------------------------------------------
// Utility: chat-panel summary line
// ---------------------------------------------------------------------------

export function formatParallelSummary(result: ParallelRunResult): string {
  const ok = result.results.filter((r) => r.status === 'ok').length;
  const total = result.results.length;
  const lines = [
    `**Parallel group** — ${ok}/${total} agents succeeded · merge: \`${result.strategy}\` · ${result.totalDurationMs}ms`,
    '',
    ...result.results.map((r) => {
      const icon =
        r.status === 'ok'      ? '✅' :
        r.status === 'timeout' ? '⏱' :
        r.status === 'aborted' ? '⛔' : '❌';
      const detail = r.status !== 'ok' && r.error
        ? ` — ${r.error}`
        : ` — ${r.durationMs}ms`;
      return `${icon} **${r.agentId}**${detail}`;
    }),
  ];
  return lines.join('\n');
}
