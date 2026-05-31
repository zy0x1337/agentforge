/**
 * ToolsRunner
 *
 * Rendered inside AgentExplorer when an agent has a tools.md.
 * Shows the allowlist, a run button per command, and a live output terminal.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { parseToolsMeta, runToolCommand, ToolsMeta } from '../../lib/toolsRunner';
import styles from './ToolsRunner.module.css';

interface Props {
  toolsMdContent: string;
  agentCwd: string;        // absolute path to the agent folder
  agentName: string;
}

interface OutputLine {
  id: number;
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
}

type RunState = 'idle' | 'running' | 'done' | 'error';

let _lineId = 0;
const nextId = () => ++_lineId;

export const ToolsRunner: React.FC<Props> = ({ toolsMdContent, agentCwd, agentName }) => {
  const [meta, setMeta] = useState<ToolsMeta | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [runState, setRunState] = useState<RunState>('idle');
  const [activeCmd, setActiveCmd] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Parse tools.md whenever content changes
  useEffect(() => {
    try {
      setMeta(parseToolsMeta(toolsMdContent));
      setParseError(null);
    } catch (e) {
      setParseError(String(e));
      setMeta(null);
    }
  }, [toolsMdContent]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [output]);

  const appendLine = useCallback((text: string, stream: OutputLine['stream']) => {
    setOutput((prev) => [...prev, { id: nextId(), text, stream }]);
  }, []);

  const handleRun = useCallback(async (rawCommand: string) => {
    if (!meta || runState === 'running') return;

    // Clean up any previous run
    cleanupRef.current?.();
    setOutput([]);
    setExitCode(null);
    setActiveCmd(rawCommand);
    setRunState('running');

    const runId = `${agentName}-${Date.now()}`;

    appendLine(`$ ${rawCommand}`, 'system');

    const cleanup = await runToolCommand({
      runId,
      rawCommand,
      agentCwd,
      meta,
      onLine: (line, stream) => appendLine(line, stream),
      onDone: (code, error) => {
        if (error) appendLine(`\u26a0 ${error}`, 'stderr');
        appendLine(
          code === 0
            ? `\u2714 Exited with code 0`
            : `\u2716 Exited with code ${code}`,
          code === 0 ? 'system' : 'stderr',
        );
        setExitCode(code);
        setRunState(code === 0 ? 'done' : 'error');
      },
    });

    cleanupRef.current = cleanup;
  }, [meta, runState, agentCwd, agentName, appendLine]);

  const handleClear = () => {
    setOutput([]);
    setExitCode(null);
    setRunState('idle');
    setActiveCmd(null);
  };

  if (parseError) {
    return (
      <div className={styles.error}>
        <span className={styles.errorIcon}>⚠</span>
        <pre>{parseError}</pre>
      </div>
    );
  }

  if (!meta) return null;

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>Tools</span>
        <span className={styles.timeout}>timeout: {meta.timeout}s</span>
        {meta.cwd && <span className={styles.cwd}>cwd: {meta.cwd}</span>}
      </div>

      {/* Command list */}
      <ul className={styles.commandList}>
        {meta.allowed_commands.map((cmd) => (
          <li key={cmd} className={styles.commandItem}>
            <code className={styles.commandCode}>{cmd}</code>
            <button
              className={styles.runBtn}
              onClick={() => handleRun(cmd)}
              disabled={runState === 'running'}
              aria-label={`Run: ${cmd}`}
            >
              {runState === 'running' && activeCmd === cmd ? (
                <span className={styles.spinner} aria-hidden="true" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <path d="M2 1.5l9 4.5-9 4.5V1.5z" />
                </svg>
              )}
              {runState === 'running' && activeCmd === cmd ? 'Running…' : 'Run'}
            </button>
          </li>
        ))}
      </ul>

      {/* Terminal output */}
      {output.length > 0 && (
        <div className={styles.terminal} ref={terminalRef} role="log" aria-live="polite" aria-label="Tool output">
          {output.map((line) => (
            <div
              key={line.id}
              className={[
                styles.line,
                line.stream === 'stderr' ? styles.lineErr : '',
                line.stream === 'system' ? styles.lineSys : '',
              ].filter(Boolean).join(' ')}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}

      {/* Footer controls */}
      {output.length > 0 && (
        <div className={styles.footer}>
          {exitCode !== null && (
            <span className={exitCode === 0 ? styles.exitOk : styles.exitErr}>
              exit {exitCode}
            </span>
          )}
          <button className={styles.clearBtn} onClick={handleClear}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
};

export default ToolsRunner;
