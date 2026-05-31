/**
 * useWorkflowStore
 *
 * Single source of truth for the active workflow run.
 *
 * Responsibilities
 * ────────────────
 * 1. AbortController lifecycle  (startRun / abort / finishRun)
 * 2. RunEvent dispatcher         (handleEvent)
 *    – Maintains activeRun: WorkflowRun with live WorkflowStep[]
 *    – Each RunEvent mutates the correct step in-place via immer-style
 *      functional updates (no immer dep needed — we spread manually)
 * 3. Exposes activeRun so useGraphStore can subscribe and re-render
 *
 * Event → Step mapping
 * ────────────────────
 * run_start           → creates a fresh WorkflowRun, steps = []
 * agent_start         → appends a new WorkflowStep (status: running)
 * agent_chunk         → appends chunk to step.output (streaming)
 * agent_done          → closes step (status: done, final output)
 * agent_error         → closes step (status: error | aborted)
 * parallel_group_done → finds the matching pending parallel step and
 *                        fills step.parallelGroup + status: done
 * run_done            → marks run status: done
 * run_error           → marks run status: error
 * run_aborted         → marks run status: aborted
 */

import { create } from 'zustand';
import type { RunEvent, WorkflowRun, WorkflowStep } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function now() { return Date.now(); }

/** Replace one step by index, returning a new steps array (no mutation). */
function replaceStep(
  steps: WorkflowStep[],
  index: number,
  patch: Partial<WorkflowStep>,
): WorkflowStep[] {
  return steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

/** Find last step index matching agentId. */
function lastIndexOf(steps: WorkflowStep[], agentId: string): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].agentId === agentId) return i;
  }
  return -1;
}

/** Find index of the pending parallel placeholder for a given agent set. */
function parallelPlaceholderIndex(
  steps: WorkflowStep[],
  agentIds: string[],
): number {
  // Match by comparing sorted agentIds of the parallelGroup placeholder
  const key = [...agentIds].sort().join('|');
  for (let i = steps.length - 1; i >= 0; i--) {
    const pg = steps[i].parallelGroup;
    if (pg && [...pg.agentIds].sort().join('|') === key) return i;
  }
  return -1;
}

// ── store ─────────────────────────────────────────────────────────────────────

export interface WorkflowStoreState {
  /** Null when no run is in progress or has ever run. */
  activeRun: WorkflowRun | null;
  isRunning: boolean;
  abortController: AbortController | null;

  // ── AbortController lifecycle ──────────────────────────────────────────────

  /**
   * Creates a fresh AbortController + WorkflowRun, marks isRunning = true.
   * Returns the AbortSignal to pass into runWorkflow().
   */
  startRun: (runId: string, prompt: string) => AbortSignal;

  /** Abort the current run; runner will emit run_aborted via handleEvent. */
  abort: () => void;

  /** Called by the runner's run_done / run_error / run_aborted handler. */
  finishRun: () => void;

  // ── Event dispatcher ───────────────────────────────────────────────────────

  /**
   * Central RunEvent handler.
   * workflowRunner calls deps.emitEvent → this function.
   * useGraphStore subscribes to activeRun and re-derives nodes/edges.
   */
  handleEvent: (event: RunEvent) => void;
}

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  activeRun: null,
  isRunning: false,
  abortController: null,

  // ── AbortController ─────────────────────────────────────────────────────────

  startRun: (runId, prompt) => {
    get().abortController?.abort();
    const controller = new AbortController();
    const run: WorkflowRun = {
      id: runId,
      startedAt: now(),
      initialPrompt: prompt,
      steps: [],
      status: 'running',
    };
    set({ isRunning: true, abortController: controller, activeRun: run });
    return controller.signal;
  },

  abort: () => {
    get().abortController?.abort();
    // status update happens via run_aborted event from the runner
  },

  finishRun: () => {
    set({ isRunning: false, abortController: null });
  },

  // ── Event dispatcher ─────────────────────────────────────────────────────────

  handleEvent: (event) => {
    set((state) => {
      const run = state.activeRun;

      // Ignore events that arrive after a run was cleared
      if (!run && event.type !== 'run_start') return state;

      switch (event.type) {

        // ── run_start: already handled by startRun(), just a no-op guard ──────
        case 'run_start':
          return state;

        // ── agent_start: open a new sequential step ───────────────────────────
        case 'agent_start': {
          // Don't create a new step if there's already a running step for this
          // agent (parallel agents emit agent_start but get their own slot via
          // parallel_group_done — we track them inside parallelGroup.results).
          // Simple heuristic: skip if a parallel placeholder exists for this agent.
          const alreadyInParallel = run!.steps.some(
            (s) =>
              s.parallelGroup?.agentIds.includes(event.agentId) &&
              s.status !== 'done',
          );
          if (alreadyInParallel) return state;

          const newStep: WorkflowStep = {
            agentId: event.agentId,
            input: '',          // will be set by agent_done when output is known
            output: '',
            status: 'running',
            contextMode: 'summary',
          };
          return {
            ...state,
            activeRun: { ...run!, steps: [...run!.steps, newStep] },
          };
        }

        // ── agent_chunk: stream output into the open step ────────────────────
        case 'agent_chunk': {
          const idx = lastIndexOf(run!.steps, event.agentId);
          if (idx === -1) return state;
          const steps = replaceStep(run!.steps, idx, {
            output: (run!.steps[idx].output ?? '') + event.chunk,
          });
          return { ...state, activeRun: { ...run!, steps } };
        }

        // ── agent_done: finalise the step ────────────────────────────────────
        case 'agent_done': {
          const idx = lastIndexOf(run!.steps, event.agentId);
          if (idx === -1) return state;
          const steps = replaceStep(run!.steps, idx, {
            status: 'done',
            output: event.output,
          });
          return { ...state, activeRun: { ...run!, steps } };
        }

        // ── agent_error: mark step as error / aborted ────────────────────────
        case 'agent_error': {
          const idx = lastIndexOf(run!.steps, event.agentId);
          if (idx === -1) return state;
          const steps = replaceStep(run!.steps, idx, {
            status: event.status === 'aborted' ? 'aborted' : 'error',
          });
          return { ...state, activeRun: { ...run!, steps } };
        }

        // ── parallel_group_done: fill parallelGroup on the placeholder step ──
        case 'parallel_group_done': {
          const idx = parallelPlaceholderIndex(run!.steps, event.agentIds);

          const groupData: WorkflowStep['parallelGroup'] = {
            agentIds:       event.agentIds,
            results:        [],           // detailed per-agent results not in RunEvent
            mergedOutput:   event.mergedOutput,
            strategy:       'concat',     // default; parallelRunner resolves the real one
            succeededCount: event.succeededCount,
            totalDurationMs: 0,
          };

          if (idx !== -1) {
            // Update existing placeholder
            const steps = replaceStep(run!.steps, idx, {
              status: event.succeededCount > 0 ? 'done' : 'error',
              output: event.mergedOutput,
              parallelGroup: groupData,
            });
            return { ...state, activeRun: { ...run!, steps } };
          }

          // No placeholder yet — create the step (workflow.md static runs emit
          // parallel_group_done without prior agent_start per group)
          const newStep: WorkflowStep = {
            agentId: undefined,
            input: '',
            output: event.mergedOutput,
            status: event.succeededCount > 0 ? 'done' : 'error',
            contextMode: 'full',
            parallelGroup: groupData,
          };
          return {
            ...state,
            activeRun: { ...run!, steps: [...run!.steps, newStep] },
          };
        }

        // ── run_done ─────────────────────────────────────────────────────────
        case 'run_done':
          return {
            ...state,
            isRunning: false,
            abortController: null,
            activeRun: { ...run!, status: 'done', finishedAt: event.timestamp },
          };

        // ── run_error ────────────────────────────────────────────────────────
        case 'run_error':
          return {
            ...state,
            isRunning: false,
            abortController: null,
            activeRun: { ...run!, status: 'error', finishedAt: event.timestamp },
          };

        // ── run_aborted ──────────────────────────────────────────────────────
        case 'run_aborted':
          return {
            ...state,
            isRunning: false,
            abortController: null,
            activeRun: { ...run!, status: 'aborted', finishedAt: event.timestamp },
          };

        default:
          return state;
      }
    });
  },
}));
