import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runParallelStep,
  formatParallelSummary,
} from '../parallelRunner';
import type { ParallelRunnerDeps } from '../parallelRunner';
import type { ParallelGroupStep } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStep(
  agents: string[],
  overrides: Partial<ParallelGroupStep> = {}
): ParallelGroupStep {
  return {
    type: 'parallel',
    agents,
    merge_strategy: 'concat',
    timeout_ms: 5_000,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ParallelRunnerDeps> = {}): ParallelRunnerDeps {
  return {
    runSingleAgent: vi.fn().mockResolvedValue('mock output'),
    emitEvent:      vi.fn(),
    getAgentMeta:   vi.fn().mockReturnValue({ id: 'agent', model: 'llama3.2:3b', maxTokens: 512 }),
    ...overrides,
  };
}

const SIGNAL = new AbortController().signal;
const RUN_ID = 'test-run-1';

// ── runParallelStep ───────────────────────────────────────────────────────────

describe('runParallelStep', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('runs all agents and returns merged concat output', async () => {
    const deps = makeDeps({
      runSingleAgent: vi
        .fn()
        .mockImplementation((id: string) => Promise.resolve(`output from ${id}`)),
    });
    const step = makeStep(['coder', 'reviewer']);

    const result = await runParallelStep(step, 'Hello', SIGNAL, deps, RUN_ID);

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.status === 'ok')).toBe(true);
    expect(result.merged).toContain('output from coder');
    expect(result.merged).toContain('output from reviewer');
    expect(result.strategy).toBe('concat');
    expect(result.anySucceeded).toBe(true);
  });

  it('marks agent as error when getAgentMeta returns undefined', async () => {
    const deps = makeDeps({
      getAgentMeta: vi.fn().mockReturnValue(undefined),
    });
    const result = await runParallelStep(
      makeStep(['ghost']),
      'prompt',
      SIGNAL,
      deps,
      RUN_ID,
    );

    expect(result.results[0].status).toBe('error');
    expect(result.results[0].error).toMatch(/not found/);
    expect(result.anySucceeded).toBe(false);
  });

  it('handles a failing agent gracefully — other agents still succeed', async () => {
    const deps = makeDeps({
      runSingleAgent: vi
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('boom')))
        .mockResolvedValue('good output'),
    });
    const step = makeStep(['bad', 'good']);

    const result = await runParallelStep(step, 'prompt', SIGNAL, deps, RUN_ID);

    const bad  = result.results.find((r) => r.agentId === 'bad')!;
    const good = result.results.find((r) => r.agentId === 'good')!;

    expect(bad.status).toBe('error');
    expect(bad.error).toBe('boom');
    expect(good.status).toBe('ok');
    expect(result.anySucceeded).toBe(true);
  });

  it('emits agent_start and agent_done events for each agent', async () => {
    const emitEvent = vi.fn();
    const deps = makeDeps({ emitEvent });
    const step = makeStep(['a', 'b']);

    await runParallelStep(step, 'prompt', SIGNAL, deps, RUN_ID);

    const types = emitEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain('agent_start');
    expect(types).toContain('agent_done');
    expect(types).toContain('parallel_group_done');
  });

  it('emits agent_error event for failing agent', async () => {
    const emitEvent = vi.fn();
    const deps = makeDeps({
      emitEvent,
      runSingleAgent: vi.fn().mockRejectedValue(new Error('fail')),
    });

    await runParallelStep(makeStep(['x']), 'prompt', SIGNAL, deps, RUN_ID);

    const errorEvents = emitEvent.mock.calls
      .map((c) => c[0] as { type: string })
      .filter((e) => e.type === 'agent_error');
    expect(errorEvents).toHaveLength(1);
  });

  it('vote strategy: picks majority choice', async () => {
    const votes = [
      JSON.stringify({ choice: 'Option A', reason: 'better' }),
      JSON.stringify({ choice: 'Option A', reason: 'faster' }),
      JSON.stringify({ choice: 'Option B', reason: 'simpler' }),
    ];
    const deps = makeDeps({
      runSingleAgent: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(votes[0]))
        .mockImplementationOnce(() => Promise.resolve(votes[1]))
        .mockImplementationOnce(() => Promise.resolve(votes[2])),
    });
    const step = makeStep(['a1', 'a2', 'a3'], { merge_strategy: 'vote' });

    const result = await runParallelStep(step, 'prompt', SIGNAL, deps, RUN_ID);
    expect(result.merged).toContain('Option A');
    expect(result.merged).toContain('2/3 votes');
  });

  it('vote strategy: handles malformed JSON gracefully', async () => {
    const deps = makeDeps({
      runSingleAgent: vi.fn().mockResolvedValue('not json at all'),
    });
    const step = makeStep(['a1'], { merge_strategy: 'vote' });

    const result = await runParallelStep(step, 'prompt', SIGNAL, deps, RUN_ID);
    expect(result.merged).toContain('not json at all');
  });

  it('returns totalDurationMs as a non-negative number', async () => {
    const deps = makeDeps();
    const result = await runParallelStep(makeStep(['a']), 'prompt', SIGNAL, deps, RUN_ID);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('empty merged string when all agents fail with concat strategy', async () => {
    const deps = makeDeps({
      runSingleAgent: vi.fn().mockRejectedValue(new Error('all fail')),
    });
    const result = await runParallelStep(makeStep(['x', 'y']), 'p', SIGNAL, deps, RUN_ID);
    expect(result.merged).toBe('');
    expect(result.anySucceeded).toBe(false);
  });
});

// ── formatParallelSummary ─────────────────────────────────────────────────────

describe('formatParallelSummary', () => {
  it('shows correct ok/total count', () => {
    const result = {
      merged: 'x',
      strategy: 'concat' as const,
      totalDurationMs: 1200,
      anySucceeded: true,
      results: [
        { agentId: 'a', output: 'out', durationMs: 500, status: 'ok' as const },
        { agentId: 'b', output: '',    durationMs: 700, status: 'error' as const, error: 'boom' },
      ],
    };
    const summary = formatParallelSummary(result);
    expect(summary).toContain('1/2 agents succeeded');
    expect(summary).toContain('✅ **a**');
    expect(summary).toContain('❌ **b**');
    expect(summary).toContain('boom');
  });

  it('shows timeout icon for timed-out agent', () => {
    const result = {
      merged: '',
      strategy: 'concat' as const,
      totalDurationMs: 5000,
      anySucceeded: false,
      results: [
        { agentId: 'slow', output: '', durationMs: 5000, status: 'timeout' as const, error: 'Timed out' },
      ],
    };
    expect(formatParallelSummary(result)).toContain('⏱ **slow**');
  });

  it('shows abort icon for aborted agent', () => {
    const result = {
      merged: '',
      strategy: 'concat' as const,
      totalDurationMs: 100,
      anySucceeded: false,
      results: [
        { agentId: 'stopper', output: '', durationMs: 100, status: 'aborted' as const },
      ],
    };
    expect(formatParallelSummary(result)).toContain('⛔ **stopper**');
  });
});
