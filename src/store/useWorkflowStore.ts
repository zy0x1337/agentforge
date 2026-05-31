/**
 * Workflow store — manages the AbortController lifecycle.
 *
 * Usage:
 *   const { startRun, abort, isRunning } = useWorkflowStore();
 *
 *   // Start
 *   const signal = startRun();
 *   runWorkflow(..., signal);
 *
 *   // Abort anywhere (e.g. Stop button)
 *   abort();
 */
import { create } from "zustand";

interface WorkflowStore {
  isRunning: boolean;
  abortController: AbortController | null;

  /** Creates a fresh AbortController, stores it, marks isRunning = true.
   *  Returns the signal to pass into runWorkflow(). */
  startRun: () => AbortSignal;

  /** Aborts the current run and resets state. */
  abort: () => void;

  /** Mark the run as finished (called by the runner on completion). */
  finishRun: () => void;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  isRunning: false,
  abortController: null,

  startRun: () => {
    // Cancel any still-running previous controller
    get().abortController?.abort();

    const controller = new AbortController();
    set({ isRunning: true, abortController: controller });
    return controller.signal;
  },

  abort: () => {
    get().abortController?.abort();
    set({ isRunning: false, abortController: null });
  },

  finishRun: () => {
    set({ isRunning: false, abortController: null });
  },
}));
