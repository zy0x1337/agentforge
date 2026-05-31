import { useWorkflowStore } from "@/store/useWorkflowStore";

/**
 * Floating stop button — rendered inside ChatPanel when a workflow is running.
 * Calls abort() on the workflow store which triggers the AbortSignal.
 */
export default function StopButton() {
  const { isRunning, abort } = useWorkflowStore();

  if (!isRunning) return null;

  return (
    <button
      onClick={abort}
      aria-label="Stop running workflow"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-4)",
        background: "var(--color-surface-2)",
        border: "1px solid oklch(from var(--color-text) l c h / 0.12)",
        borderRadius: "var(--radius-full)",
        color: "var(--color-notification)",
        fontSize: "var(--text-sm)",
        fontFamily: "var(--font-body)",
        cursor: "pointer",
        boxShadow: "var(--shadow-md)",
        transition: "background var(--transition-interactive), box-shadow var(--transition-interactive)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-offset)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-lg)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-2)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-md)";
      }}
    >
      {/* Square stop icon */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="currentColor"
        aria-hidden="true"
      >
        <rect x="2" y="2" width="10" height="10" rx="1.5" />
      </svg>
      Stop
    </button>
  );
}
