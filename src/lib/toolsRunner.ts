/**
 * toolsRunner.ts
 *
 * Parses an agent's tools.md, validates commands against the allowlist,
 * and executes them via the Tauri `run_tool_command` command.
 *
 * Events emitted by Rust (tool://output, tool://done) are forwarded to
 * the caller via the onLine / onDone callbacks.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import matter from 'gray-matter';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolsMeta {
  allowed_commands: string[];
  timeout: number; // seconds; 0 = no timeout
  cwd?: string;   // override working directory
}

export interface RunToolOptions {
  runId: string;
  rawCommand: string;   // the full command string from tools.md, e.g. "python scripts/lint.py"
  agentCwd: string;     // absolute path to the agent folder (used as cwd fallback)
  meta: ToolsMeta;
  onLine: (line: string, stream: 'stdout' | 'stderr') => void;
  onDone: (exitCode: number, error?: string) => void;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

/**
 * Parse a tools.md file content and return its frontmatter as ToolsMeta.
 * Throws if `allowed_commands` is missing or empty.
 */
export function parseToolsMeta(toolsMdContent: string): ToolsMeta {
  const { data } = matter(toolsMdContent);

  if (!Array.isArray(data.allowed_commands) || data.allowed_commands.length === 0) {
    throw new Error('tools.md must define at least one entry in `allowed_commands`');
  }

  return {
    allowed_commands: data.allowed_commands as string[],
    timeout: typeof data.timeout === 'number' ? data.timeout : 30,
    cwd: typeof data.cwd === 'string' ? data.cwd : undefined,
  };
}

// ─── Allowlist validation ─────────────────────────────────────────────────────

/**
 * Checks whether `rawCommand` is present (exact match) in `allowed_commands`.
 * Returns the command and its argument list if allowed, throws otherwise.
 */
export function validateCommand(
  rawCommand: string,
  meta: ToolsMeta,
): { executable: string; args: string[] } {
  const normalised = rawCommand.trim();

  if (!meta.allowed_commands.includes(normalised)) {
    throw new Error(
      `Command not in allowlist: "${normalised}"\n` +
      `Allowed: ${meta.allowed_commands.map((c) => `"${c}"`).join(', ')}`,
    );
  }

  // Split into executable + args respecting quoted substrings
  const parts = splitCommand(normalised);
  if (parts.length === 0) throw new Error('Empty command after split');

  return { executable: parts[0], args: parts.slice(1) };
}

/**
 * Minimal shell-like split: honours double and single quotes.
 * e.g. 'python run.py --msg "hello world"' → ['python', 'run.py', '--msg', 'hello world']
 */
function splitCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (const ch of cmd) {
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === ' ' && !inDouble && !inSingle) {
      if (current) { parts.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

// ─── Executor ─────────────────────────────────────────────────────────────────

/**
 * Validate then execute a single tool command.
 * Returns a cleanup function that unlisten from Tauri events.
 */
export async function runToolCommand(opts: RunToolOptions): Promise<() => void> {
  const { runId, rawCommand, agentCwd, meta, onLine, onDone } = opts;

  const { executable, args } = validateCommand(rawCommand, meta);
  const cwd = meta.cwd ?? agentCwd;

  // Register event listeners before invoking so we never miss the first event
  const unlisteners: UnlistenFn[] = [];

  const unOut = await listen<{ run_id: string; line: string; stream: 'stdout' | 'stderr' }>(
    'tool://output',
    ({ payload }) => {
      if (payload.run_id === runId) onLine(payload.line, payload.stream);
    },
  );

  const unDone = await listen<{ run_id: string; exit_code: number; error?: string }>(
    'tool://done',
    ({ payload }) => {
      if (payload.run_id === runId) {
        onDone(payload.exit_code, payload.error);
        cleanup();
      }
    },
  );

  unlisteners.push(unOut, unDone);

  const cleanup = () => unlisteners.forEach((fn) => fn());

  try {
    await invoke('run_tool_command', {
      runId,
      command: executable,
      args,
      cwd,
      timeoutSecs: meta.timeout,
    });
  } catch (err) {
    onDone(-1, String(err));
    cleanup();
  }

  return cleanup;
}
