import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { runWorkflow } from "@/lib/workflowRunner";
import StopButton from "./StopButton";
import type { Agent, WorkflowRun } from "@/types";

export default function ChatPanel() {
  const {
    agents, settings,
    addRunStep,
    streamBuffer, appendStream, clearStream,
  } = useAppStore();

  const { isRunning, startRun, finishRun } = useWorkflowStore();
  const { runs, activeRunId, setActiveRunId, addRun } = useHistoryStore();

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // The run currently displayed (active selection or latest)
  const displayRun: WorkflowRun | null =
    runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayRun?.steps.length, streamBuffer]);

  const run = async () => {
    if (!input.trim() || isRunning || !settings.defaultModel) return;
    const prompt = input.trim();
    setInput("");
    clearStream();

    const newRun: WorkflowRun = {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      initialPrompt: prompt,
      steps: [],
      status: "running",
    };
    addRun(newRun);
    setActiveRunId(newRun.id);

    const signal = startRun();

    try {
      const completed = await runWorkflow(
        prompt,
        agents,
        settings.defaultModel,
        settings.defaultModel,
        addRunStep,
        appendStream,
        signal,
      );
      // Replace the in-progress run with the finished one
      addRun(completed);
    } catch (err) {
      console.error(err);
    } finally {
      finishRun();
    }
  };

  const canSubmit = !isRunning && !!input.trim() && !!settings.defaultModel;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
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
              {displayRun.finishedAt && ` · ${Math.round((displayRun.finishedAt - displayRun.startedAt) / 1000)}s`}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {settings.defaultModel
            ? <span style={{ fontSize: "var(--text-xs)", color: "var(--color-primary)", fontFamily: "var(--font-mono)" }}>
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
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--color-gold)", animation: "pulse 1.2s ease-in-out infinite" }} />
              running
            </span>
          )}
        </div>
      </div>

      {/* Message list */}
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
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
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
                key={`${step.agentId}-${i}`}
                agentId={step.agentId}
                content={step.output ?? (streamBuffer[step.agentId] ?? "")}
                status={step.status}
                agents={agents}
              />
            ))}
            {isRunning && !displayRun.steps.some((s) => s.status === "running") && (
              <div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>Routing…</div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Stop button */}
      <div style={{ display: "flex", justifyContent: "center", minHeight: isRunning ? 40 : 0, transition: "min-height var(--transition-interactive)" }}>
        <StopButton />
      </div>

      {/* Input bar */}
      <div style={{
        padding: "var(--space-4) var(--space-6)",
        borderTop: "1px solid oklch(from var(--color-text) l c h / 0.08)",
        display: "flex",
        gap: "var(--space-3)",
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
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
            opacity: canSubmit ? 1 : 0.4,
            alignSelf: "flex-end",
            fontWeight: 500,
            transition: "opacity var(--transition-interactive), background var(--transition-interactive)",
          }}
        >
          &#9654; Run
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

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

function AgentBubble({
  agentId, content, status, agents,
}: {
  agentId: string;
  content: string;
  status: string;
  agents: Agent[];
}) {
  const agent = agents.find((a) => a.id === agentId);
  const isAborted = status === "aborted";
  const isError   = status === "error";

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        marginBottom: "var(--space-2)",
      }}>
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
      </div>
      <div style={{
        background: isAborted
          ? "color-mix(in oklab, var(--color-notification) 6%, var(--color-surface-2))"
          : isError
            ? "color-mix(in oklab, var(--color-error) 6%, var(--color-surface-2))"
            : "var(--color-surface-2)",
        border: `1px solid ${
          isAborted ? "oklch(from var(--color-notification) l c h / 0.2)"
          : isError  ? "oklch(from var(--color-error) l c h / 0.2)"
          :            "oklch(from var(--color-text) l c h / 0.08)"
        }`,
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
