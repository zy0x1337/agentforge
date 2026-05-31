/**
 * StopButton
 *
 * Calls useWorkflowStore.abort() — the AbortController signal propagates
 * through all in-flight fetch() streams in workflowRunner + parallelRunner.
 */
import { useWorkflowStore } from "@/store/useWorkflowStore";

export default function StopButton() {
  const { isRunning, abort } = useWorkflowStore();

  if (!isRunning) return null;

  return (
    <button
      onClick={abort}
      aria-label="Stop workflow"
      style={{
        padding: "var(--space-2) var(--space-5)",
        background: "transparent",
        border: "1px solid oklch(from var(--color-error) l c h / 0.5)",
        color: "var(--color-error)",
        borderRadius: "var(--radius-full)",
        fontSize: "var(--text-xs)",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background var(--transition-interactive), border-color var(--transition-interactive)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "color-mix(in oklab, var(--color-error) 10%, transparent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      ■ Stop
    </button>
  );
}
