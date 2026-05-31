/**
 * Sidebar — navigation, run history, Ollama status footer, settings trigger.
 *
 * Layout:
 *   ┌─────────────────────┐
 *   │ ⧡ AgentForge       │  ← logo + name
 *   ├─────────────────────┤
 *   │ Models              │  ← nav
 *   │ Agents              │
 *   │ Run                 │
 *   │ Graph               │
 *   ├─────────────────────┤
 *   │ RUNS          Clear │  ← run history
 *   │  ● prompt…         │
 *   │    14:23 · 18s      │
 *   ├─────────────────────┤
 *   │ ● Ollama  [settings]│  ← footer
 *   └─────────────────────┘
 */

import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { SettingsPanel } from "@/components/Settings/SettingsPanel";
import type { Panel } from "@/store/useAppStore";
import styles from "./Sidebar.module.css";

const NAV_ITEMS: { id: Panel; label: string; icon: React.ReactNode }[] = [
  {
    id: "models",
    label: "Models",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="2" y="2" width="12" height="3" rx="1" />
        <rect x="2" y="6.5" width="12" height="3" rx="1" />
        <rect x="2" y="11" width="12" height="3" rx="1" />
      </svg>
    ),
  },
  {
    id: "agents",
    label: "Agents",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 13V5l6-3 6 3v8" />
        <rect x="5" y="8" width="3" height="5" />
        <rect x="8" y="8" width="3" height="5" />
      </svg>
    ),
  },
  {
    id: "chat",
    label: "Run",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <polygon points="3,2 13,8 3,14" />
      </svg>
    ),
  },
  {
    id: "graph",
    label: "Graph",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8" cy="3" r="2" />
        <circle cx="3" cy="13" r="2" />
        <circle cx="13" cy="13" r="2" />
        <path d="M8 5v2.5M8 7.5L3 11M8 7.5L13 11" />
      </svg>
    ),
  },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function Sidebar() {
  const { activePanel, setActivePanel, ollamaRunning } = useAppStore();
  const { history, activeRunId, setActiveRunId, clearHistory } = useHistoryStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.logo}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <polygon points="10,2 18,7 18,13 10,18 2,13 2,7" stroke="var(--primary)" strokeWidth="1.5" fill="none" />
            <circle cx="10" cy="10" r="2.5" fill="var(--primary)" />
          </svg>
          <span className={styles.logoText}>AgentForge</span>
        </div>

        {/* Nav */}
        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`${styles.navBtn} ${
                activePanel === item.id ? styles.navBtnActive : ""
              }`}
              onClick={() => setActivePanel(item.id)}
              aria-current={activePanel === item.id ? "page" : undefined}
            >
              <span className={styles.navIcon} aria-hidden>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.divider} />

        {/* Run history */}
        <div className={styles.historySection}>
          <div className={styles.historyHeader}>
            <span className={styles.historyTitle}>Runs</span>
            {history.length > 0 && (
              <button
                className={styles.clearBtn}
                onClick={clearHistory}
                aria-label="Clear run history"
              >
                Clear
              </button>
            )}
          </div>

          <div className={styles.historyList}>
            {history.length === 0 && (
              <p className={styles.emptyHistory}>
                No runs yet. Start a workflow in Run.
              </p>
            )}
            {history.map((run) => {
              const duration =
                run.finishedAt != null
                  ? formatDuration(run.finishedAt - run.startedAt)
                  : null;
              const agentChain = [
                ...new Set(run.steps.map((s) => s.agentId)),
              ].join(" → ");
              const isActive = run.id === activeRunId;

              return (
                <button
                  key={run.id}
                  className={`${styles.historyItem} ${
                    isActive ? styles.historyItemActive : ""
                  }`}
                  onClick={() => {
                    setActiveRunId(run.id);
                    // Navigate to graph for a visual replay of the run
                    setActivePanel("graph");
                  }}
                >
                  <span
                    className={`${styles.statusDot} ${styles[`dot_${run.status}`]}`}
                    aria-label={run.status}
                  />
                  <span className={styles.historyContent}>
                    <span className={styles.historyPrompt}>
                      {run.initialPrompt.slice(0, 60)}
                    </span>
                    <span className={styles.historyMeta}>
                      {formatTime(run.startedAt)}
                      {duration && ` · ${duration}`}
                    </span>
                    {agentChain && (
                      <span className={styles.historyChain}>{agentChain}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.ollamaStatus}>
            <span
              className={`${styles.statusDot} ${
                ollamaRunning ? styles.dot_done : styles.dot_error
              }`}
            />
            <span className={styles.ollamaLabel}>
              {ollamaRunning ? "Ollama running" : "Ollama offline"}
            </span>
          </span>
          <button
            className={styles.settingsBtn}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
            </svg>
          </button>
        </div>
      </aside>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
