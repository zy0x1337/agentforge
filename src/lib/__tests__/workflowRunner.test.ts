import { describe, it, expect, vi } from 'vitest';
import { runWorkflow, type WorkflowRunnerDeps, type StepOverrides } from '../workflowRunner';
import type { RunEvent } from '../../types';

/**
 * These tests verify the *runtime effect* of workflow.md step fields that the
 * parser understands — step-level model/temperature overrides, prompt_override
 * interpolation, condition gating, and on_error/retry — not merely that they
 * parse.
 */

const SIGNAL = new AbortController().signal;

interface Recorded {
  agentId: string;
  inputContext: string;
  overrides?: StepOverrides;
}

function makeDeps(
  workflowMd: string,
  runSingleAgent: WorkflowRunnerDeps['runSingleAgent'],
): { deps: WorkflowRunnerDeps; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const deps: WorkflowRunnerDeps = {
    runSingleAgent,
    emitEvent: (e) => events.push(e),
    getAgentMeta: (id) => ({ id, contextMode: 'full' }),
    readAgentFile: async (_id, filename) =>
      filename === 'workflow.md' ? workflowMd : null,
  };
  return { deps, events };
}

describe('runWorkflow — step overrides', () => {
  it('forwards step-level model + temperature to runSingleAgent', async () => {
    const calls: Recorded[] = [];
    const runSingleAgent = vi.fn(
      async (agentId: string, inputContext: string, _s: AbortSignal, _c: (x: string) => void, overrides?: StepOverrides) => {
        calls.push({ agentId, inputContext, overrides });
        return 'ok';
      },
    );
    const wf = [
      '---',
      'steps:',
      '  - agent: coder',
      '    model: custom-model',
      '    temperature: 0.2',
      '---',
    ].join('\n');

    const { deps } = makeDeps(wf, runSingleAgent);
    await runWorkflow('coder', 'hello', SIGNAL, deps, 'r1');

    expect(calls).toHaveLength(1);
    expect(calls[0].overrides).toEqual({ model: 'custom-model', temperature: 0.2 });
  });
});

describe('runWorkflow — prompt_override', () => {
  it('interpolates {{input}} and {{previous}} into the agent input', async () => {
    const calls: Recorded[] = [];
    const outputs = ['FIRST', 'SECOND'];
    let i = 0;
    const runSingleAgent = vi.fn(
      async (agentId: string, inputContext: string, _s: AbortSignal, _c: (x: string) => void, overrides?: StepOverrides) => {
        calls.push({ agentId, inputContext, overrides });
        return outputs[i++];
      },
    );
    const wf = [
      '---',
      'steps:',
      '  - agent: first',
      '  - agent: second',
      "    prompt_override: 'Refine: {{previous}} (orig: {{input}})'",
      '---',
    ].join('\n');

    const { deps } = makeDeps(wf, runSingleAgent);
    await runWorkflow('first', 'do-it', SIGNAL, deps, 'r2');

    expect(calls[1].inputContext).toBe('Refine: FIRST (orig: do-it)');
  });
});

describe('runWorkflow — condition', () => {
  it('skips a step whose condition is not met', async () => {
    const calls: string[] = [];
    const runSingleAgent = vi.fn(async (agentId: string) => {
      calls.push(agentId);
      return 'out';
    });
    const wf = [
      '---',
      'steps:',
      "  - agent: gated",
      "    condition: \"previous_output contains 'GO'\"",
      '---',
    ].join('\n');

    const { deps, events } = makeDeps(wf, runSingleAgent);
    // initial context is the prompt, which does not contain 'GO'
    await runWorkflow('gated', 'nothing here', SIGNAL, deps, 'r3');

    expect(calls).toEqual([]); // step skipped → agent never invoked
    expect(events.some((e) => e.type === 'run_done')).toBe(true);
  });
});

describe('runWorkflow — on_error', () => {
  it('continue: keeps going after a failing step', async () => {
    const calls: string[] = [];
    const runSingleAgent = vi.fn(async (agentId: string) => {
      calls.push(agentId);
      if (agentId === 'boom') throw new Error('kaboom');
      return 'ok';
    });
    const wf = [
      '---',
      'on_error: continue',
      'steps:',
      '  - agent: boom',
      '  - agent: safe',
      '---',
    ].join('\n');

    const { deps, events } = makeDeps(wf, runSingleAgent);
    await runWorkflow('boom', 'go', SIGNAL, deps, 'r4');

    expect(calls).toEqual(['boom', 'safe']); // second step still ran
    expect(events.some((e) => e.type === 'run_done')).toBe(true);
    expect(events.some((e) => e.type === 'run_error')).toBe(false);
  });

  it('retry: re-runs a failing step up to max_retries', async () => {
    let attempts = 0;
    const runSingleAgent = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw new Error('transient');
      return 'recovered';
    });
    const wf = [
      '---',
      'on_error: retry',
      'max_retries: 2',
      'steps:',
      '  - agent: flaky',
      '---',
    ].join('\n');

    const { deps, events } = makeDeps(wf, runSingleAgent);
    const result = await runWorkflow('flaky', 'go', SIGNAL, deps, 'r5');

    expect(attempts).toBe(2);
    expect(result).toBe('recovered');
    expect(events.some((e) => e.type === 'run_done')).toBe(true);
  });
});
