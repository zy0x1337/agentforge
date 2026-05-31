import { useAppStore } from "@/store/useAppStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import type { WorkflowRun } from "@/types";

const NAV = [
  { id: "models" as const, icon: "Models", label: "Models" },
  { id: "agents" as const, icon: "Agents", label: "Agents" },
  { id: "chat"   as const, icon: "Run",    label: "Run"    },
] as const;

// ── helpers ───────────────────────────────────────────────────────────────────

function statusDot(status: WorkflowRun["status"]) {
  const colors: Record<WorkflowRun["status"], string> = {
    running: "var(--color-gold)",
    done:    "var(--color-success)",
    error:   "var(--color-error)",
    aborted: "var(--color-text-faint)",
  };
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "var(--radius-full)",
        background: colors[status],
        flexShrink: 0,
        marginTop: 2,
        ...(status === "running" ? { animation: "pulse 1.2s ease-in-out infinite" } : {}),
      }}
    />
  );
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(run: WorkflowRun) {
  if (!run.finishedAt) return null;
  const s = Math.round((run.finishedAt - run.startedAt) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── NavButton ─────────────────────────────────────────────────────────────────

function NavButton({ id, label, active, onClick }: {
  id: string; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      style={{
        width: "100%",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--text-xs)",
        fontWeight: active ? 600 : 400,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: active ? "var(--color-primary)" : "var(--color-text-muted)",
        background: active
          ? "color-mix(in oklab, var(--color-primary) 8%, var(--color-surface-2))"
          : "transparent",
        textAlign: "left",
        transition: "background var(--transition-interactive), color var(--transition-interactive)",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "var(--color-surface-offset)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

// ── RunItem ───────────────────────────────────────────────────────────────────

function RunItem({ run, isActive, onClick }: {
  run: WorkflowRun;
  isActive: boolean;
  onClick: () => void;
}) {
  const duration = formatDuration(run);
  const agentIds = [...new Set(run.steps.map((s) => s.agentId))];

  return (
    <button
      onClick={onClick}
      title={run.initialPrompt}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-sm)",
        background: isActive
          ? "color-mix(in oklab, var(--color-primary) 8%, var(--color-surface-2))"
          : "transparent",
        border: isActive
          ? "1px solid oklch(from var(--color-primary) l c h / 0.2)"
          : "1px solid transparent",
        cursor: "pointer",
        transition: "background var(--transition-interactive), border-color var(--transition-interactive)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = "var(--color-surface-offset)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }
      }}
    >
      {/* Row 1: status dot + truncated prompt */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
        {statusDot(run.status)}
        <span style={{
          fontSize: "var(--text-xs)",
          color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
          lineHeight: 1.4,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          wordBreak: "break-word",
        }}>
          {run.initialPrompt}
        </span>
      </div>

      {/* Row 2: time + duration + step count */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        paddingLeft: "var(--space-4)",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)" }}>
          {formatTime(run.startedAt)}
        </span>
        {duration && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)" }}>
            {duration}
          </span>
        )}
        {agentIds.length > 0 && (
          <span style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-faint)",
            fontFamily: "var(--font-mono)",
          }}>
            {agentIds.join(" → ")}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { activePanel, setActivePanel, ollamaRunning } = useAppStore();
  const { runs, activeRunId, setActiveRunId, clearHistory } = useHistoryStore();
  const { isRunning } = useWorkflowStore();

  const handleRunClick = (run: WorkflowRun) => {
    setActiveRunId(run.id);
    setActivePanel("chat");
  };

  return (
    <nav
      aria-label="Application navigation"
      style={{
        width: 220,
        minWidth: 180,
        background: "var(--color-surface)",
        borderRight: "1px solid oklch(from var(--color-text) l c h / 0.08)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div style={{
        padding: "var(--space-4) var(--space-4) var(--space-3)",
        borderBottom: "1px solid oklch(from var(--color-text) l c h / 0.06)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
      }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <polygon points="10,2 18,6 18,14 10,18 2,14 2,6" stroke="var(--color-primary)" strokeWidth="1.5" fill="none" />
          <circle cx="10" cy="10" r="2.5" fill="var(--color-primary)" />
        </svg>
        <span style={{
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: "var(--color-text)",
          letterSpacing: "-0.01em",
        }}>
          AgentForge
        </span>
      </div>

      {/* Nav links */}
      <div style={{ padding: "var(--space-3) var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {NAV.map((item) => (
          <NavButton
            key={item.id}
            id={item.id}
            label={item.label}
            active={activePanel === item.id && item.id !== "chat"}
            onClick={() => setActivePanel(item.id)}
          />
        ))}
      </div>

      {/* History section */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderTop: "1px solid oklch(from var(--color-text) l c h / 0.06)",
      }}>
        {/* Section header */}
        <div style={{
          padding: "var(--space-3) var(--space-3) var(--space-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--color-text-faint)",
          }}>
            Runs
          </span>
          {runs.length > 0 && (
            <button
              onClick={clearHistory}
              title="Clear history"
              aria-label="Clear run history"
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-faint)",
                padding: "var(--space-1)",
                borderRadius: "var(--radius-sm)",
                transition: "color var(--transition-interactive)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--color-notification)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--color-text-faint)";
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Run list */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 var(--space-2) var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
        }}>
          {runs.length === 0 && !isRunning && (
            <p style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-faint)",
              padding: "var(--space-2) var(--space-1)",
              lineHeight: 1.5,
            }}>
              No runs yet. Start a workflow in Run.
            </p>
          )}
          {runs.map((run) => (
            <RunItem
              key={run.id}
              run={run}
              isActive={run.id === activeRunId}
              onClick={() => handleRunClick(run)}
            />
          ))}
        </div>
      </div>

      {/* Footer: Ollama status */}
      <div style={{
        padding: "var(--space-3) var(--space-4)",
        borderTop: "1px solid oklch(from var(--color-text) l c h / 0.06)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
      }}>
        <div
          title={ollamaRunning ? "Ollama running" : "Ollama offline"}
          style={{
            width: 7,
            height: 7,
            borderRadius: "var(--radius-full)",
            background: ollamaRunning ? "var(--color-success)" : "var(--color-error)",
            flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: "var(--text-xs)",
          color: "var(--color-text-faint)",
        }}>
          {ollamaRunning ? "Ollama running" : "Ollama offline"}
        </span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </nav>
  );
}
