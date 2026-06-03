/**
 * ChatPanel
 *
 * Displays the active (or selected historical) workflow run as a chat thread.
 *
 * State ownership after store cleanup:
 * ─────────────────────────────────────
 * • agents, settings          → useAppStore   (unchanged)
 * • isRunning, activeRun,
 *   startRun, abort, finishRun,
 *   handleEvent               → useWorkflowStore
 * • runs, activeRunId,
 *   addRun, hydrateHistory    → useHistoryStore
 *
 * No more streamBuffer / appendStream in useAppStore.
 * Streaming text is read directly from activeRun.steps[n].output
 * (useWorkflowStore.handleEvent appends chunks via agent_chunk events).
 */
import { useState, useRef, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/useAppStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { runWorkflow, type WorkflowRunnerDeps } from "@/lib/workflowRunner";
import { routeToAgent } from "@/lib/router";
import { chatStream, normalizeModelName } from "@/lib/ollama";
import {
  readFileForContext,
  readFolderForContext,
  formatContextBlock,
  parseWriteFileBlocks,
  type AttachedFile,
  type FileWriteOp,
} from "@/lib/contextFiles";
import { FileChangeReview } from "./FileChangeReview";
import StopButton from "./StopButton";
import type { Agent, ChatMessage, WorkflowRun } from "@/types";

export default function ChatPanel() {
  const { agents, settings, localModels } = useAppStore();

  const {
    activeRun,
    isRunning,
    startRun,
    finishRun,
    handleEvent,
  } = useWorkflowStore();

  const { runs, activeRunId, setActiveRunId, addRun } = useHistoryStore();

  const [input, setInput] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [pendingWrites, setPendingWrites] = useState<FileWriteOp[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  /**
   * Displayed run: prefer the run the user clicked in history,
   * fall back to the live activeRun, then the most recent history entry.
   */
  const displayRun: WorkflowRun | null =
    (activeRunId ? runs.find((r) => r.id === activeRunId) : null)
    ?? activeRun
    ?? runs[0]
    ?? null;

  // Length of all streamed output so far — drives auto-scroll on each chunk.
  const streamedLength =
    activeRun?.steps.map((s) => s.output).join("").length ?? 0;

  // Auto-scroll to bottom when new steps/chunks arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayRun?.steps.length, streamedLength]);

  const attachFiles = async () => {
    const paths = await openDialog({ multiple: true, directory: false });
    if (!paths) return;
    const list = Array.isArray(paths) ? paths : [paths];
    const results = await Promise.all(list.map(readFileForContext));
    const valid = results.filter(Boolean) as AttachedFile[];
    setAttachedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      return [...prev, ...valid.filter((f) => !existing.has(f.path))];
    });
  };

  const attachFolder = async () => {
    const folder = await openDialog({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    const { files, skipped } = await readFolderForContext(folder);
    setAttachedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      return [...prev, ...files.filter((f) => !existing.has(f.path))];
    });
    if (skipped > 0) setRunError(`${skipped} file(s) skipped (binary / too large / limit reached)`);
  };

  const removeAttached = (path: string) =>
    setAttachedFiles((prev) => prev.filter((f) => f.path !== path));

  const run = async () => {
    if (!input.trim() || isRunning || !settings.defaultModel) return;
    const prompt = input.trim();
    setInput("");
    setRunError(null);

    // Prepend attached file context to the prompt sent to the workflow.
    // The display prompt (stored in activeRun) stays clean.
    const contextBlock = formatContextBlock(attachedFiles);
    const fullPrompt = contextBlock + prompt;

    const runId = crypto.randomUUID();
    const signal = startRun(runId, prompt);
    setActiveRunId(runId);

    try {
      // ── Routing: pick the entry agent for this prompt ──────────────────────
      const entry = await routeToAgent(fullPrompt, agents, settings.defaultModel, {
        baseUrl: settings.ollamaBaseUrl,
        embedModel: settings.embedModel,
        skipSemantic:
          settings.routingMode === "no-semantic" ||
          settings.routingMode === "rules-only",
        skipLlm: settings.routingMode === "rules-only",
        signal,
      });
      if (!entry) throw new Error("No agent matched this prompt");

      // ── Dependency injection for the workflow runner ───────────────────────
      const agentById = new Map(agents.map((a) => [a.id, a]));

      const deps: WorkflowRunnerDeps = {
        runSingleAgent: async (agentId, inputContext, sig, onChunk, overrides) => {
          const agent = agentById.get(agentId);
          if (!agent) throw new Error(`Unknown agent: ${agentId}`);
          // Step-level overrides win; agent model used only if it's installed,
          // otherwise fall back to the app default so runs never silently fail.
          const agentModel = agent.frontmatter.model;
          const agentModelInstalled =
            !!agentModel &&
            localModels.some(
              (m) => normalizeModelName(m.name) === normalizeModelName(agentModel),
            );
          const model =
            overrides?.model ||
            (agentModelInstalled ? agentModel : null) ||
            settings.defaultModel;
          const temperature =
            overrides?.temperature ?? agent.frontmatter.temperature ?? 0.7;
          const system =
            agent.persona + (agent.prompt ? `\n\n${agent.prompt}` : "");
          const messages: ChatMessage[] = [
            { role: "system", content: system },
            { role: "user", content: inputContext || fullPrompt },
          ];
          let out = "";
          await chatStream(
            model,
            messages,
            (token) => {
              out += token;
              onChunk(token);
            },
            temperature,
            sig,
            settings.ollamaBaseUrl,
          );
          return out;
        },
        emitEvent: handleEvent,
        getAgentMeta: (agentId) => {
          const a = agentById.get(agentId);
          if (!a) return undefined;
          return {
            id: a.id,
            model: a.frontmatter.model,
            maxTokens: a.frontmatter.max_tokens,
            contextMode: a.frontmatter.context_mode,
            nextAgents: a.frontmatter.next_agents,
          };
        },
        readAgentFile: async (agentId, filename) => {
          const a = agentById.get(agentId);
          if (!a) return null;
          if (filename === "workflow.md") return a.workflow ?? null;
          if (filename === "persona.md") return a.persona ?? null;
          if (filename === "prompt.md") return a.prompt ?? null;
          return null;
        },
      };

      await runWorkflow(entry.id, fullPrompt, signal, deps, runId);

      // Persist the finished run to history.
      const finished = useWorkflowStore.getState().activeRun;
      if (finished) await addRun(finished);

      // Parse agent output for proposed file writes → show confirmation UI.
      const allOutput = finished?.steps.map((s) => s.output ?? "").join("\n") ?? "";
      const writes = parseWriteFileBlocks(allOutput);
      if (writes.length > 0) setPendingWrites(writes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunError(msg);
    } finally {
      finishRun();
    }
  };

  const canSubmit = !isRunning && !!input.trim() && !!settings.defaultModel;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "var(--space-4) var(--space-6)",
        borderBottom: "1px solid oklch(from var(--color-text) l c h / 0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Agent Run</span>
          {displayRun && displayRun.status !== "running" && (
            <span style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-faint)",
              fontFamily: "var(--font-mono)",
            }}>
              {displayRun.status}
              {displayRun.finishedAt &&
                ` · ${Math.round((displayRun.finishedAt - displayRun.startedAt) / 1000)}s`}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {settings.defaultModel
            ? <span style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-primary)",
                fontFamily: "var(--font-mono)",
              }}>
                {settings.defaultModel}
              </span>
            : <span style={{ fontSize: "var(--text-xs)", color: "var(--color-error)" }}>
                No default model — set one in Models
              </span>
          }
          {isRunning && (
            <span style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-gold)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-1)",
            }}>
              <span style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--color-gold)",
                animation: "pulse 1.2s ease-in-out infinite",
              }} />
              running
            </span>
          )}
        </div>
      </div>

      {/* ── Message list ──────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}>
        {!displayRun && (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "var(--space-3)",
            color: "var(--color-text-muted)",
            marginTop: "var(--space-16)",
          }}>
            <svg
              width="32" height="32" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="1.5"
              aria-hidden="true"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <p style={{ fontSize: "var(--text-sm)" }}>Enter a prompt to start a workflow</p>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)" }}>
              {agents.length} agent{agents.length !== 1 ? "s" : ""} loaded
            </p>
          </div>
        )}

        {displayRun && (
          <>
            <UserBubble text={displayRun.initialPrompt} />

            {displayRun.steps.map((step, i) => (
              <AgentBubble
                key={`${step.agentId ?? "parallel"}-${i}`}
                agentId={step.agentId}
                content={step.output ?? ""}
                status={step.status}
                agents={agents}
                parallelGroup={step.parallelGroup}
              />
            ))}

            {/* Routing indicator: run active but no step is open yet */}
            {isRunning && !displayRun.steps.some((s) => s.status === "running") && (
              <div style={{
                color: "var(--color-text-muted)",
                fontSize: "var(--text-xs)",
                padding: "var(--space-2) 0",
              }}>
                Routing…
              </div>
            )}
          </>
        )}

        {runError && (
          <div style={{
            padding: "var(--space-3) var(--space-4)",
            background: "color-mix(in oklab, var(--color-error) 8%, var(--color-surface-2))",
            border: "1px solid oklch(from var(--color-error) l c h / 0.3)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-error)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-mono)",
          }}>
            {runError}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Stop button ───────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        minHeight: isRunning ? 40 : 0,
        transition: "min-height var(--transition-interactive)",
      }}>
        <StopButton />
      </div>

      {/* ── File change review overlay ────────────────────────────────────── */}
      {pendingWrites.length > 0 && (
        <FileChangeReview
          ops={pendingWrites}
          onClose={() => setPendingWrites([])}
        />
      )}

      {/* ── Input bar ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: "var(--space-3) var(--space-6) var(--space-4)",
        borderTop: "1px solid oklch(from var(--color-text) l c h / 0.08)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}>
        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
            {attachedFiles.map((f) => (
              <span
                key={f.path}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "var(--space-1)",
                  padding: "1px var(--space-2)",
                  background: "var(--color-surface-3)",
                  borderRadius: "var(--radius-full)",
                  fontSize: "0.65rem",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-muted)",
                  maxWidth: 200,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <button
                  onClick={() => removeAttached(f.path)}
                  style={{ color: "var(--color-text-muted)", lineHeight: 1, flexShrink: 0 }}
                  title="Remove"
                >×</button>
              </span>
            ))}
            <button
              onClick={() => setAttachedFiles([])}
              style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", padding: "1px var(--space-2)" }}
            >
              Clear all
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          {/* Attach buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", justifyContent: "flex-end" }}>
            <button
              onClick={attachFiles}
              disabled={isRunning}
              title="Attach files"
              style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)", opacity: isRunning ? 0.4 : 1 }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3.5" />
                <path d="M9 1h6v6" /><path d="M15 1L7.5 8.5" />
              </svg>
            </button>
            <button
              onClick={attachFolder}
              disabled={isRunning}
              title="Attach folder"
              style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)", padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)", opacity: isRunning ? 0.4 : 1 }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" />
              </svg>
            </button>
          </div>

          <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Enter a prompt… (Shift+Enter for newline)"
          rows={2}
          disabled={isRunning}
          style={{
            flex: 1,
            padding: "var(--space-3)",
            background: "var(--color-surface-2)",
            border: "1px solid oklch(from var(--color-text) l c h / 0.12)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-text)",
            resize: "none",
            fontSize: "var(--text-sm)",
            opacity: isRunning ? 0.5 : 1,
            transition: "opacity var(--transition-interactive)",
          }}
        />
        <button
          onClick={run}
          disabled={!canSubmit}
          aria-label="Run workflow"
          style={{
            padding: "var(--space-3) var(--space-5)",
            background: "var(--color-primary)",
            color: "#fff",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            opacity: canSubmit ? 1 : 0.4,
            alignSelf: "flex-end",
            transition: "opacity var(--transition-interactive), background var(--transition-interactive)",
          }}
        >
          &#9654; Run
        </button>
        </div>{/* end flex row */}
      </div>{/* end input bar */}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{
        background: "var(--color-primary)",
        color: "#fff",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-lg)",
        maxWidth: "70%",
        fontSize: "var(--text-sm)",
        lineHeight: 1.5,
      }}>
        {text}
      </div>
    </div>
  );
}

type ParallelGroupMeta = {
  agentIds: string[];
  mergedOutput: string;
  strategy: string;
  succeededCount: number;
  totalDurationMs: number;
};

function AgentBubble({
  agentId,
  content,
  status,
  agents,
  parallelGroup,
}: {
  agentId?: string;
  content: string;
  status: string;
  agents: Agent[];
  parallelGroup?: ParallelGroupMeta & { results: unknown[] };
}) {
  const agent      = agentId ? agents.find((a) => a.id === agentId) : null;
  const isAborted  = status === "aborted";
  const isError    = status === "error";
  const isParallel = !!parallelGroup;

  const borderColor = isAborted
    ? "oklch(from var(--color-notification) l c h / 0.2)"
    : isError
      ? "oklch(from var(--color-error) l c h / 0.2)"
      : "oklch(from var(--color-text) l c h / 0.08)";

  const bgColor = isAborted
    ? "color-mix(in oklab, var(--color-notification) 6%, var(--color-surface-2))"
    : isError
      ? "color-mix(in oklab, var(--color-error) 6%, var(--color-surface-2))"
      : "var(--color-surface-2)";

  return (
    <div>
      {/* Label row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        marginBottom: "var(--space-2)",
        flexWrap: "wrap",
      }}>
        {isParallel ? (
          <>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-purple)", fontWeight: 600 }}>
              ⟳ Parallel · {parallelGroup!.strategy}
            </span>
            <span style={{
              fontSize: "var(--text-xs)",
              color: parallelGroup!.succeededCount === parallelGroup!.agentIds.length
                ? "var(--color-success)"
                : "var(--color-warning)",
            }}>
              {parallelGroup!.succeededCount}/{parallelGroup!.agentIds.length} ok
            </span>
            {parallelGroup!.totalDurationMs > 0 && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)" }}>
                · {(parallelGroup!.totalDurationMs / 1000).toFixed(1)}s
              </span>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-primary)", fontWeight: 600 }}>
              ◈ {agent?.frontmatter.name ?? agentId}
            </span>
            {status === "running" && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>…</span>
            )}
            {isError && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-error)" }}>error</span>
            )}
            {isAborted && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-notification)" }}>aborted</span>
            )}
          </>
        )}
      </div>

      {/* Bubble */}
      <div style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.7,
        color: (isAborted || isError) ? "var(--color-text-muted)" : "var(--color-text)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxWidth: "85%",
      }}>
        {content
          ? content
          : status === "running"
            ? <span style={{ color: "var(--color-text-faint)" }}>Thinking…</span>
            : <span style={{ color: "var(--color-text-faint)" }}>No output</span>
        }
      </div>
    </div>
  );
}
