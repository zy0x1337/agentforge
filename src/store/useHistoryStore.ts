/**
 * useHistoryStore
 *
 * Single source of truth for completed WorkflowRuns.
 *
 * Persistence
 * ───────────
 * Runs are saved to disk via tauri-plugin-store (key: agentforge_run_history).
 * On mount, call `hydrateHistory()` once to load persisted runs.
 * Every `addRun` call automatically persists the updated list.
 *
 * Limits
 * ──────
 * Max 50 runs in memory + on disk. Oldest are dropped when the cap is reached.
 */
import { create } from "zustand";
import type { WorkflowRun } from "@/types";
import { loadHistory, saveHistory } from "@/lib/historyPersist";

const MAX_HISTORY = 50;

interface HistoryStore {
  runs: WorkflowRun[];
  /** ID of the run currently displayed in ChatPanel. */
  activeRunId: string | null;
  /** True while hydrateHistory() is loading from disk. */
  hydrating: boolean;

  /**
   * Load persisted runs from disk into memory.
   * Call once in App.tsx on mount (after tauri-plugin-store is ready).
   */
  hydrateHistory: () => Promise<void>;

  /**
   * Push a completed (or aborted/errored) run to the top of history
   * and persist to disk.
   */
  addRun: (run: WorkflowRun) => Promise<void>;

  /** Select a run to display in ChatPanel. */
  setActiveRunId: (id: string | null) => void;

  /**
   * Wipe all in-memory history and clear the persisted store key.
   */
  clearHistory: () => Promise<void>;
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  runs: [],
  activeRunId: null,
  hydrating: false,

  // ── Hydration ──────────────────────────────────────────────────────────────

  hydrateHistory: async () => {
    set({ hydrating: true });
    try {
      const persisted = await loadHistory();
      set({ runs: persisted, hydrating: false });
    } catch {
      // If the store key doesn't exist yet, that's fine — start empty.
      set({ hydrating: false });
    }
  },

  // ── Mutations ──────────────────────────────────────────────────────────────

  addRun: async (run) => {
    // Skip runs that are still in progress — only persist finished states.
    if (run.status === "running") {
      set((s) => ({
        runs: [run, ...s.runs.filter((r) => r.id !== run.id)].slice(0, MAX_HISTORY),
        activeRunId: run.id,
      }));
      return;
    }

    set((s) => {
      const next = [run, ...s.runs.filter((r) => r.id !== run.id)].slice(0, MAX_HISTORY);
      return { runs: next, activeRunId: run.id };
    });

    // Persist only finished runs (done | error | aborted).
    const finished = get().runs.filter((r) => r.status !== "running");
    await saveHistory(finished);
  },

  setActiveRunId: (id) => set({ activeRunId: id }),

  clearHistory: async () => {
    set({ runs: [], activeRunId: null });
    await saveHistory([]);
  },
}));
