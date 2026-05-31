/**
 * Run History store — persists completed WorkflowRuns in memory (last 50).
 *
 * Usage:
 *   const { runs, addRun, clearHistory, activeRunId, setActiveRunId } = useHistoryStore();
 */
import { create } from "zustand";
import type { WorkflowRun } from "@/types";

const MAX_HISTORY = 50;

interface HistoryStore {
  runs: WorkflowRun[];
  activeRunId: string | null;

  /** Push a completed run to the top of history. */
  addRun: (run: WorkflowRun) => void;

  /** Select a run to display in the ChatPanel. */
  setActiveRunId: (id: string | null) => void;

  /** Wipe all history. */
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  runs: [],
  activeRunId: null,

  addRun: (run) =>
    set((s) => ({
      runs: [run, ...s.runs].slice(0, MAX_HISTORY),
      activeRunId: run.id,
    })),

  setActiveRunId: (id) => set({ activeRunId: id }),

  clearHistory: () => set({ runs: [], activeRunId: null }),
}));
