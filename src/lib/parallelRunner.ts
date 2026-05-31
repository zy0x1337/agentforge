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
 * ─────────────────
 * concat     Raw outputs appended in declaration order (default)
 * summarise  A lightweight summariser prompt condenses all results
 * vote       Structured { choice, reason } outputs; majority wins
 */

import type { AgentMeta } from '../types';
import { ollamaChat, ollamaChatStream } from './ollama';
import { buildSystemPrompt } from './workflowRunner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeStrategy = 'concat' | 'summarise' | 'vote';

export interface ParallelStep {
  agents: string[];          // agent folder names
  mode: 'parallel';
  merge_strategy?: MergeStrategy;
  timeout_ms?: number;       // per-agent timeout (default: 120 000)
}

export interface AgentResult {
  agentId: string;
  output: string;
  durationMs: number;
  status: 'ok' | 'error' | 'timeout' | 'aborted';
  error?: string;
}

export interface ParallelRunResult {
  merged: string;            // final merged context for next step
  results: AgentResult[];    // per-agent raw results
  strategy: MergeStrategy;
  totalDurationMs: number;
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
// Single-agent runner (streaming, with timeout + abort)
// ---------------------------------------------------------------------------

async function runSingleAgent(
  agentId: string,
  agentMeta: AgentMeta,
  inputContext: string,
  signal: AbortSignal,
  timeoutMs: number,
  onToken?: (agentId: string, token: string) => void,
): Promise<AgentResult> {
  const start = performance.now();

  // Per-agent timeout races against the shared abort signal
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  // Combine: abort if either parent signal OR timeout fires
  const combinedSignal = AbortSignal.any
    ? AbortSignal.any([signal, timeoutController.signal])
    : signal; // fallback for older runtimes

  try {
    const systemPrompt = buildSystemPrompt(agentMeta);
    const budgeted = budgetContext(inputContext, agentMeta.max_tokens ?? 2048);

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: budgeted },
    ];

    let output = '';

    if (onToken) {
      // Streaming path
      await ollamaChatStream(
        {
          model: agentMeta.model,
          messages,
          options: {
            temperature: agentMeta.temperature ?? 0.7,
            num_predict: agentMeta.max_tokens ?? 2048,
          },
        },
        combinedSignal,
        (token) => {
          output += token;
          onToken(agentId, token);
        },
      );
    } else {
      // Non-streaming path (used for vote strategy merge)
      output = await ollamaChat(
        {
          model: agentMeta.model,
          messages,
          options: {
            temperature: agentMeta.temperature ?? 0.7,
            num_predict: agentMeta.max_tokens ?? 2048,
          },
        },
        combinedSignal,
      );
    }

    clearTimeout(timeoutId);
    return {
      agentId,
      output,
      durationMs: Math.round(performance.now() - start),
      status: 'ok',
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = Math.round(performance.now() - start);

    if (timeoutController.signal.aborted) {
      return { agentId, output: '', durationMs, status: 'timeout', error: `Timed out after ${timeoutMs}ms` };
    }
    if (signal.aborted) {
      return { agentId, output: '', durationMs, status: 'aborted' };
    }
    return {
      agentId,
      output: '',
      durationMs,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
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

/**
 * Vote merge: each agent should have returned JSON `{ choice: string, reason: string }`.
 * The choice with the most votes wins; ties resolved by first occurrence.
 */
function mergeVote(results: AgentResult[]): string {
  interface VotePayload { choice: string; reason: string; }

  const votes: Array<{ agentId: string } & VotePayload> = [];

  for (const r of results) {
    if (r.status !== 'ok' || !r.output) continue;
    try {
      // Strip markdown code fences if present
      const raw = r.output.replace(/^```[\w]*\n?/m, '').replace(/```$/m, '').trim();
      const parsed = JSON.parse(raw) as VotePayload;
      votes.push({ agentId: r.agentId, ...parsed });
    } catch {
      // Non-JSON output: treat the entire output as the choice
      votes.push({ agentId: r.agentId, choice: r.output.trim(), reason: '' });
    }
  }

  if (votes.length === 0) return '';

  // Tally
  const tally = new Map<string, { count: number; reasons: string[] }>();
  for (const v of votes) {
    const key = v.choice.toLowerCase().trim();
    const entry = tally.get(key) ?? { count: 0, reasons: [] };
    entry.count++;
    if (v.reason) entry.reasons.push(`${v.agentId}: ${v.reason}`);
    tally.set(key, entry);
  }

  // Winner
  const [winnerKey, winnerData] = [...tally.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const winnerChoice = votes.find((v) => v.choice.toLowerCase().trim() === winnerKey)?.choice ?? winnerKey;

  const lines = [
    `**Vote result:** ${winnerChoice} (${winnerData.count}/${votes.length} votes)`,
  ];
  if (winnerData.reasons.length) {
    lines.push('', '**Reasons:**', ...winnerData.reasons.map((r) => `- ${r}`));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main parallel runner
// ---------------------------------------------------------------------------

export async function runParallelStep(
  step: ParallelStep,
  agentRegistry: Map<string, AgentMeta>,
  inputContext: string,
  defaultModel: string,
  signal: AbortSignal,
  onToken?: (agentId: string, token: string) => void,
): Promise<ParallelRunResult> {
  const start = performance.now();
  const strategy: MergeStrategy = step.merge_strategy ?? 'concat';
  const timeoutMs = step.timeout_ms ?? 120_000;

  // Fan-out: launch all agents concurrently
  const tasks = step.agents.map((agentId) => {
    const meta = agentRegistry.get(agentId);
    if (!meta) {
      // Return a synthetic error result for unknown agents
      return Promise.resolve<AgentResult>({
        agentId,
        output: '',
        durationMs: 0,
        status: 'error',
        error: `Agent "${agentId}" not found in registry`,
      });
    }

    // Resolve model: per-agent override → app default
    const resolvedMeta: AgentMeta = {
      ...meta,
      model: meta.model || defaultModel,
    };

    return runSingleAgent(agentId, resolvedMeta, inputContext, signal, timeoutMs, onToken);
  });

  // Fan-in: wait for ALL, even if some fail
  const settled = await Promise.allSettled(tasks);

  const results: AgentResult[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    // Promise itself rejected (shouldn't happen with our try/catch, but defensive)
    return {
      agentId: step.agents[i],
      output: '',
      durationMs: 0,
      status: 'error' as const,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
    };
  });

  // Merge
  let merged: string;

  if (signal.aborted) {
    // If the whole run was aborted, return whatever we collected
    merged = mergeConcat(results);
  } else {
    switch (strategy) {
      case 'summarise': {
        // Use the first successful agent's model (or default) for summarisation
        const summaryModel =
          results.find((r) => r.status === 'ok')?.agentId
            ? agentRegistry.get(results.find((r) => r.status === 'ok')!.agentId)?.model || defaultModel
            : defaultModel;
        merged = await mergeSummarise(results, summaryModel, signal);
        break;
      }
      case 'vote':
        merged = mergeVote(results);
        break;
      case 'concat':
      default:
        merged = mergeConcat(results);
    }
  }

  return {
    merged,
    results,
    strategy,
    totalDurationMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Utility: build a human-readable execution summary for the chat panel
// ---------------------------------------------------------------------------

export function formatParallelSummary(result: ParallelRunResult): string {
  const ok = result.results.filter((r) => r.status === 'ok').length;
  const total = result.results.length;
  const lines = [
    `**Parallel group** — ${ok}/${total} agents succeeded · merge: \`${result.strategy}\` · ${result.totalDurationMs}ms`,
    '',
    ...result.results.map((r) => {
      const icon = r.status === 'ok' ? '✅' : r.status === 'timeout' ? '⏱' : r.status === 'aborted' ? '⛔' : '❌';
      const detail = r.status !== 'ok' && r.error ? ` — ${r.error}` : ` — ${r.durationMs}ms`;
      return `${icon} **${r.agentId}**${detail}`;
    }),
  ];
  return lines.join('\n');
}
