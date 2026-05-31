/**
 * HistorySidebar
 *
 * Scrollable list of all past workflow runs, newest first.
 * Clicking an entry loads it into ChatPanel by setting activeRunId.
 *
 * Features
 * ────────
 * - Status badge (done ✓ | error ✕ | aborted ⊘) with colour coding
 * - Duration in seconds
 * - Truncated prompt preview (first 80 chars)
 * - Agent chain summary (→ router → coder → reviewer)
 * - Relative timestamp ("2 min ago", "yesterday")
 * - Clear-all button with inline confirmation
 */
import { useState } from "react";
import { useHistoryStore } from "@/store/useHistoryStore";
import type { WorkflowRun } from "@/types";
import styles from "./HistorySidebar.module.css";

export default function HistorySidebar() {
  const { runs, activeRunId, setActiveRunId, clearHistory } = useHistoryStore();
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearHistory();
    setConfirmClear(false);
  };

  return (
    <aside className={styles.sidebar} aria-label="Run history">
      <header className={styles.header}>
        <span className={styles.title}>History</span>
        {runs.length > 0 && (
          <button
            className={styles.clearBtn}
            onClick={handleClear}
            title={confirmClear ? "Click again to confirm" : "Clear all history"}
          >
            {confirmClear ? "Sure?" : "Clear"}
          </button>
        )}
      </header>

      {runs.length === 0 ? (
        <div className={styles.empty}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M12 8v4l3 3" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          <p>No runs yet</p>
        </div>
      ) : (
        <ul className={styles.list} role="list">
          {runs.map((run) => (
            <RunItem
              key={run.id}
              run={run}
              active={run.id === activeRunId}
              onClick={() => setActiveRunId(run.id)}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

// ── RunItem ──────────────────────────────────────────────────────────────────

function RunItem({
  run, active, onClick,
}: {
  run: WorkflowRun;
  active: boolean;
  onClick: () => void;
}) {
  const duration = run.finishedAt
    ? Math.round((run.finishedAt - run.startedAt) / 1000)
    : null;

  const agentChain = run.steps
    .map((s) => s.agentId ?? "parallel")
    .filter(Boolean)
    .join(" → ");

  const promptPreview = run.initialPrompt.slice(0, 80) +
    (run.initialPrompt.length > 80 ? "…" : "");

  return (
    <li>
      <button
        className={`${styles.item} ${active ? styles.itemActive : ""}`}
        onClick={onClick}
        aria-current={active ? "true" : undefined}
      >
        <div className={styles.itemTop}>
          <StatusBadge status={run.status} />
          <span className={styles.timestamp}>{relativeTime(run.startedAt)}</span>
          {duration !== null && (
            <span className={styles.duration}>{duration}s</span>
          )}
        </div>

        <p className={styles.prompt}>{promptPreview}</p>

        {agentChain && (
          <p className={styles.chain}>{agentChain}</p>
        )}
      </button>
    </li>
  );
}

// ── StatusBadge ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  done:    "✓ done",
  error:   "✕ error",
  aborted: "⊘ aborted",
  running: "● running",
};

const STATUS_COLOR: Record<string, string> = {
  done:    "var(--color-success)",
  error:   "var(--color-error)",
  aborted: "var(--color-notification)",
  running: "var(--color-gold)",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: "var(--text-xs)",
      color: STATUS_COLOR[status] ?? "var(--color-text-muted)",
      fontWeight: 600,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)  return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
