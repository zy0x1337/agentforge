import { describe, it, expect } from 'vitest';
import {
  parseWorkflow,
  evaluateCondition,
  WorkflowParseError,
} from '../workflowParser';

// ─── parseWorkflow ────────────────────────────────────────────────────────────

describe('parseWorkflow', () => {
  it('parses a minimal valid workflow', () => {
    const src = `---
steps:
  - agent: router
---`;
    const wf = parseWorkflow(src);
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0].agent).toBe('router');
    expect(wf.mode).toBe('sequential');
    expect(wf.onError).toBe('stop');
    expect(wf.maxRetries).toBe(1);
  });

  it('parses all top-level fields', () => {
    const src = `---
steps:
  - agent: coder
  - agent: reviewer
mode: sequential
on_error: retry
max_retries: 3
description: Full pipeline
---`;
    const wf = parseWorkflow(src);
    expect(wf.steps).toHaveLength(2);
    expect(wf.mode).toBe('sequential');
    expect(wf.onError).toBe('retry');
    expect(wf.maxRetries).toBe(3);
    expect(wf.description).toBe('Full pipeline');
  });

  it('parses all step-level overrides', () => {
    const src = `---
steps:
  - agent: coder
    prompt_override: "Write code for: {{input}}"
    model: qwen2.5-coder:7b
    temperature: 0.2
    context_mode: full
    condition: "step_count < 3"
---`;
    const step = parseWorkflow(src).steps[0];
    expect(step.prompt_override).toBe('Write code for: {{input}}');
    expect(step.model).toBe('qwen2.5-coder:7b');
    expect(step.temperature).toBe(0.2);
    expect(step.context_mode).toBe('full');
    expect(step.condition).toBe('step_count < 3');
  });

  it('defaults mode to sequential for unknown values', () => {
    const src = `---
steps:
  - agent: router
mode: unknown_value
---`;
    expect(parseWorkflow(src).mode).toBe('sequential');
  });

  it('defaults onError to stop for unknown values', () => {
    const src = `---
steps:
  - agent: router
on_error: explode
---`;
    expect(parseWorkflow(src).onError).toBe('stop');
  });

  it('defaults maxRetries to 1 when not specified', () => {
    const src = `---
steps:
  - agent: router
---`;
    expect(parseWorkflow(src).maxRetries).toBe(1);
  });

  it('floors float max_retries to integer', () => {
    const src = `---
steps:
  - agent: router
max_retries: 2.9
---`;
    expect(parseWorkflow(src).maxRetries).toBe(2);
  });

  it('falls back to markdown body as description', () => {
    const src = `---
steps:
  - agent: router
---

This workflow does everything.`;
    expect(parseWorkflow(src).description).toBe('This workflow does everything.');
  });

  it('preserves raw source', () => {
    const src = `---
steps:
  - agent: router
---`;
    expect(parseWorkflow(src).raw).toBe(src);
  });

  // ── Error cases ────────────────────────────────────────────────────────────

  it('throws WorkflowParseError when steps is missing', () => {
    const src = `---
mode: sequential
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError when steps is empty', () => {
    const src = `---
steps: []
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError when agent field is missing', () => {
    const src = `---
steps:
  - model: llama3
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError when agent field is empty string', () => {
    const src = `---
steps:
  - agent: "   "
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError when temperature is out of range', () => {
    const src = `---
steps:
  - agent: coder
    temperature: 1.5
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError when temperature is negative', () => {
    const src = `---
steps:
  - agent: coder
    temperature: -0.1
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError for invalid context_mode', () => {
    const src = `---
steps:
  - agent: coder
    context_mode: partial
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError for non-string prompt_override', () => {
    const src = `---
steps:
  - agent: coder
    prompt_override: 42
---`;
    expect(() => parseWorkflow(src)).toThrow(WorkflowParseError);
  });
});

// ─── evaluateCondition ────────────────────────────────────────────────────────

describe('evaluateCondition', () => {
  const ctx = { previousOutput: 'The task needs implementation now', stepCount: 2 };

  it('returns true for undefined condition', () => {
    expect(evaluateCondition(undefined, ctx)).toBe(true);
  });

  it('returns true for empty string condition', () => {
    expect(evaluateCondition('', ctx)).toBe(true);
  });

  it('returns true for whitespace-only condition', () => {
    expect(evaluateCondition('   ', ctx)).toBe(true);
  });

  // contains
  it('contains: matches case-insensitively', () => {
    expect(evaluateCondition("previous_output contains 'NEEDS IMPLEMENTATION'", ctx)).toBe(true);
  });

  it('contains: returns false when substring absent', () => {
    expect(evaluateCondition("previous_output contains 'deploy'", ctx)).toBe(false);
  });

  // matches
  it('matches: returns true for matching regex', () => {
    expect(evaluateCondition("previous_output matches 'needs\\s+implementation'", ctx)).toBe(true);
  });

  it('matches: returns false for non-matching regex', () => {
    expect(evaluateCondition("previous_output matches '^deploy'", ctx)).toBe(false);
  });

  it('matches: returns true (safe fallback) for invalid regex', () => {
    expect(evaluateCondition("previous_output matches '[invalid'", ctx)).toBe(true);
  });

  // step_count operators
  it('step_count <: true when count is less', () => {
    expect(evaluateCondition('step_count < 5', ctx)).toBe(true);
  });

  it('step_count <: false when count equals bound', () => {
    expect(evaluateCondition('step_count < 2', ctx)).toBe(false);
  });

  it('step_count <=: true when count equals bound', () => {
    expect(evaluateCondition('step_count <= 2', ctx)).toBe(true);
  });

  it('step_count >: true when count exceeds bound', () => {
    expect(evaluateCondition('step_count > 1', ctx)).toBe(true);
  });

  it('step_count >=: true when count equals bound', () => {
    expect(evaluateCondition('step_count >= 2', ctx)).toBe(true);
  });

  it('step_count ==: true for exact match', () => {
    expect(evaluateCondition('step_count == 2', ctx)).toBe(true);
  });

  it('step_count ==: false for mismatch', () => {
    expect(evaluateCondition('step_count == 99', ctx)).toBe(false);
  });

  it('returns true (safe fallback) for unrecognised syntax', () => {
    expect(evaluateCondition('something_weird', ctx)).toBe(true);
  });
});
