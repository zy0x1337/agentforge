import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeToAgent, routeNext } from '../router';
import type { Agent } from '@/types';

// ── Mock heavy deps — no Ollama or embed calls in unit tests ──────────────────

vi.mock('../ollama', () => ({
  chat: vi.fn().mockResolvedValue('coder'),
}));

vi.mock('../embeddings', () => ({
  getBatchEmbeddings: vi.fn().mockResolvedValue([]),
  getEmbedding:       vi.fn().mockResolvedValue([]),
  rankBySimilarity:   vi.fn().mockReturnValue([]),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgent(
  id: string,
  name: string,
  description: string,
  triggers: string[] = [],
  nextAgents: string[] = []
): Agent {
  return {
    id,
    path: `/agents/${id}`,
    frontmatter: { name, description, triggers, next_agents: nextAgents },
    persona: "",
  };
}

const AGENTS: Agent[] = [
  makeAgent('coder',     'Coder',     'Writes TypeScript code',   ['write code', 'implement', 'typescript']),
  makeAgent('reviewer',  'Reviewer',  'Reviews code for quality', ['review', 'check', 'lint']),
  makeAgent('summarizer','Summarizer','Summarizes long text',     ['summarize', 'tldr', 'brief']),
  makeAgent('_system',   'System',    'Internal agent',           []),
];

const MODEL  = 'llama3.2:3b';

// ── routeToAgent ──────────────────────────────────────────────────────────────

describe('routeToAgent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Tier 1: matches agent by trigger keyword', async () => {
    const result = await routeToAgent(
      'please write code for a sorting algorithm',
      AGENTS,
      MODEL,
      { skipSemantic: true, skipLlm: true },
    );
    expect(result?.id).toBe('coder');
  });

  it('Tier 1: picks highest-scoring agent (most trigger hits)', async () => {
    const result = await routeToAgent(
      'review and lint the code',
      AGENTS,
      MODEL,
      { skipSemantic: true, skipLlm: true },
    );
    expect(result?.id).toBe('reviewer');
  });

  it('Tier 1: case-insensitive trigger matching', async () => {
    const result = await routeToAgent(
      'SUMMARIZE this document',
      AGENTS,
      MODEL,
      { skipSemantic: true, skipLlm: true },
    );
    expect(result?.id).toBe('summarizer');
  });

  it('Tier 1: returns null when no triggers match', async () => {
    const result = await routeToAgent(
      'something completely unrelated xyz',
      AGENTS,
      MODEL,
      { skipSemantic: true, skipLlm: true },
    );
    expect(result).toBeNull();
  });

  it('excludes agents whose id starts with underscore', async () => {
    const result = await routeToAgent(
      'internal task',
      AGENTS,
      MODEL,
      { skipSemantic: true, skipLlm: true },
    );
    expect(result?.id).not.toBe('_system');
  });

  it('returns null for empty agent list', async () => {
    const result = await routeToAgent('anything', [], MODEL, { skipSemantic: true, skipLlm: true });
    expect(result).toBeNull();
  });

  it('returns null when only underscore agents in list', async () => {
    const result = await routeToAgent(
      'anything',
      [makeAgent('_system', 'Sys', 'Internal', [])],
      MODEL,
      { skipSemantic: true, skipLlm: true },
    );
    expect(result).toBeNull();
  });

  it('Tier 3 (LLM): called when Tier 1+2 both miss', async () => {
    const { chat } = await import('../ollama');
    (chat as ReturnType<typeof vi.fn>).mockResolvedValue('coder');

    const result = await routeToAgent(
      'obscure prompt xyz',
      AGENTS,
      MODEL,
      { skipSemantic: true },
    );
    expect(chat).toHaveBeenCalledOnce();
    expect(result?.id).toBe('coder');
  });

  it('skipLlm: returns null when all tiers miss', async () => {
    const result = await routeToAgent(
      'obscure xyz',
      AGENTS,
      MODEL,
      { skipSemantic: true, skipLlm: true },
    );
    // Tier 1 miss + skipLlm → null
    expect(result).toBeNull();
  });
});

// ── routeNext ─────────────────────────────────────────────────────────────────

describe('routeNext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explicit next_agents takes priority over semantic/LLM', async () => {
    const coder = makeAgent('coder', 'Coder', 'Writes code', [], ['reviewer']);
    const reviewer = makeAgent('reviewer', 'Reviewer', 'Reviews code');

    const result = await routeNext(coder, 'some output', [coder, reviewer], MODEL, {
      skipSemantic: true,
      skipLlm: true,
    });
    expect(result?.id).toBe('reviewer');
  });

  it('returns null when explicit next_agents target does not exist', async () => {
    const coder = makeAgent('coder', 'Coder', 'Writes code', [], ['nonexistent']);
    const result = await routeNext(coder, 'output', [coder], MODEL, {
      skipSemantic: true,
      skipLlm: true,
    });
    expect(result).toBeNull();
  });

  it('does not route to itself', async () => {
    const { chat } = await import('../ollama');
    (chat as ReturnType<typeof vi.fn>).mockResolvedValue('coder');

    const coder = makeAgent('coder', 'Coder', 'Writes code');
    const result = await routeNext(coder, 'output', [coder], MODEL, {
      skipSemantic: true,
    });
    expect(result?.id).not.toBe('coder');
  });

  it('LLM returns done → routeNext returns null', async () => {
    const { chat } = await import('../ollama');
    (chat as ReturnType<typeof vi.fn>).mockResolvedValue('done');

    const coder    = makeAgent('coder',    'Coder',    'Writes code');
    const reviewer = makeAgent('reviewer', 'Reviewer', 'Reviews code');

    const result = await routeNext(coder, 'output', [coder, reviewer], MODEL, {
      skipSemantic: true,
    });
    expect(result).toBeNull();
  });

  it('LLM returns empty string → routeNext returns null', async () => {
    const { chat } = await import('../ollama');
    (chat as ReturnType<typeof vi.fn>).mockResolvedValue('');

    const coder    = makeAgent('coder',    'Coder',    'Writes code');
    const reviewer = makeAgent('reviewer', 'Reviewer', 'Reviews code');

    const result = await routeNext(coder, 'output', [coder, reviewer], MODEL, {
      skipSemantic: true,
    });
    expect(result).toBeNull();
  });

  it('skipLlm: returns null when no explicit next and LLM skipped', async () => {
    const coder    = makeAgent('coder',    'Coder',    'Writes code');
    const reviewer = makeAgent('reviewer', 'Reviewer', 'Reviews code');

    const result = await routeNext(coder, 'output', [coder, reviewer], MODEL, {
      skipSemantic: true,
      skipLlm:      true,
    });
    expect(result).toBeNull();
  });
});
