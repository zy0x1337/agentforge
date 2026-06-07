import type { AttachedFile } from "@/lib/contextFiles";

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconFile() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3.5" />
      <path d="M9 1h6v6" /><path d="M15 1L7.5 8.5" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" />
    </svg>
  );
}

// ── Chip component ────────────────────────────────────────────────────────────

function Chip({
  label,
  title,
  color,
  onRemove,
}: {
  label: string;
  title: string;
  color: "primary" | "muted";
  onRemove: () => void;
}) {
  const isPrimary = color === "primary";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "2px var(--space-2)",
        background: isPrimary
          ? "color-mix(in oklab, var(--primary) 14%, var(--surface-3))"
          : "var(--surface-3)",
        borderRadius: "var(--radius-full)",
        fontSize: "0.65rem",
        fontFamily: "var(--font-mono)",
        color: isPrimary ? "var(--primary)" : "var(--text-muted)",
        maxWidth: 200,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        style={{
          color: isPrimary ? "var(--primary)" : "var(--text-muted)",
          lineHeight: 1,
          flexShrink: 0,
          fontSize: "0.8rem",
        }}
      >
        ×
      </button>
    </span>
  );
}

// ── PromptInputBar ────────────────────────────────────────────────────────────

interface PromptInputBarProps {
  input: string;
  setInput: (v: string) => void;
  isRunning: boolean;
  canSubmit: boolean;
  attachedFiles: AttachedFile[];
  attachedFolders: string[];
  onRun: () => void;
  onAttachFiles: () => void;
  onAttachFolder: () => void;
  onRemoveFile: (path: string) => void;
  onRemoveFolder: (folder: string) => void;
  onClearAll: () => void;
}

export function PromptInputBar({
  input, setInput,
  isRunning, canSubmit,
  attachedFiles, attachedFolders,
  onRun, onAttachFiles, onAttachFolder,
  onRemoveFile, onRemoveFolder, onClearAll,
}: PromptInputBarProps) {
  const hasAttachments = attachedFolders.length > 0 || attachedFiles.length > 0;

  return (
    <div style={{
      padding: "var(--space-3) var(--space-6) var(--space-4)",
      borderTop: "1px solid oklch(from var(--text) l c h / 0.08)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)",
    }}>
      {/* Attachment chips */}
      {hasAttachments && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-1)",
          alignItems: "center",
        }}>
          {attachedFolders.map((folder) => {
            const name = folder.replace(/\\/g, "/").split("/").pop() ?? folder;
            return (
              <Chip
                key={folder}
                label={`📁 ${name}`}
                title={folder}
                color="primary"
                onRemove={() => onRemoveFolder(folder)}
              />
            );
          })}
          {attachedFiles.map((f) => (
            <Chip
              key={f.path}
              label={f.name}
              title={f.path}
              color="muted"
              onRemove={() => onRemoveFile(f.path)}
            />
          ))}
          <button
            onClick={onClearAll}
            style={{
              fontSize: "0.65rem",
              color: "var(--text-muted)",
              padding: "2px var(--space-2)",
              borderRadius: "var(--radius-full)",
              transition: "color var(--transition)",
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Input row */}
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        {/* Attach buttons */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
          justifyContent: "flex-end",
        }}>
          <button
            onClick={onAttachFiles}
            disabled={isRunning}
            title="Attach files (Cmd+Shift+F)"
            style={{
              color: "var(--text-muted)",
              padding: "var(--space-1) var(--space-2)",
              borderRadius: "var(--radius-sm)",
              opacity: isRunning ? 0.4 : 1,
              transition: "color var(--transition), opacity var(--transition)",
            }}
          >
            <IconFile />
          </button>
          <button
            onClick={onAttachFolder}
            disabled={isRunning}
            title="Attach folder"
            style={{
              color: "var(--text-muted)",
              padding: "var(--space-1) var(--space-2)",
              borderRadius: "var(--radius-sm)",
              opacity: isRunning ? 0.4 : 1,
              transition: "color var(--transition), opacity var(--transition)",
            }}
          >
            <IconFolder />
          </button>
        </div>

        {/* Textarea */}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onRun();
            }
          }}
          placeholder="Enter a prompt… (Shift+Enter for newline)"
          rows={2}
          disabled={isRunning}
          style={{
            flex: 1,
            padding: "var(--space-3)",
            background: "var(--surface-2)",
            border: "1px solid oklch(from var(--text) l c h / 0.12)",
            borderRadius: "var(--radius-md)",
            color: "var(--text)",
            resize: "none",
            fontSize: "var(--text-sm)",
            opacity: isRunning ? 0.5 : 1,
            transition: "opacity var(--transition), border-color var(--transition)",
          }}
        />

        {/* Run button */}
        <button
          onClick={onRun}
          disabled={!canSubmit}
          aria-label="Run workflow"
          style={{
            padding: "var(--space-3) var(--space-5)",
            background: canSubmit ? "var(--primary)" : "var(--surface-3)",
            color: canSubmit ? "#fff" : "var(--text-faint)",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            alignSelf: "flex-end",
            transition: "background var(--transition), color var(--transition)",
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          &#9654; Run
        </button>
      </div>
    </div>
  );
}
