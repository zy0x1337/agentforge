/**
 * FileChangeReview — shows agent-proposed file writes as diffs before
 * applying them. Each op is tracked independently; errors are shown inline.
 */

import { useState, useEffect, useRef } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  diffLines,
  collapseDiff,
  type FileWriteOp,
  type DiffLine,
} from "@/lib/contextFiles";

type ItemStatus = "pending" | "applying" | "applied" | "rejected" | "error";

interface FileReviewState {
  op: FileWriteOp;
  oldContent: string;
  diff: DiffLine[];
  status: ItemStatus;
  error?: string;
}

interface Props {
  ops: FileWriteOp[];
  onClose: () => void;
}

export function FileChangeReview({ ops, onClose }: Props) {
  const [items, setItems]       = useState<FileReviewState[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number>(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const itemsRef = useRef<FileReviewState[]>([]);
  itemsRef.current = items;

  // Load current file contents + compute diffs on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const states = await Promise.all(
        ops.map(async (op) => {
          const oldContent = await readTextFile(op.path).catch(() => "");
          const raw  = diffLines(oldContent, op.newContent);
          const diff = collapseDiff(raw);
          return { op, oldContent, diff, status: "pending" as const };
        }),
      );
      if (!cancelled) {
        setItems(states);
        // Auto-expand first item
        setExpandedIdx(0);
      }
    })();
    return () => { cancelled = true; };
  }, [ops]);

  const setItemStatus = (idx: number, status: ItemStatus, error?: string) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, status, error: error ?? it.error } : it,
      ),
    );
  };

  const applyOne = async (idx: number, item: FileReviewState) => {
    setItemStatus(idx, "applying");
    try {
      await writeTextFile(item.op.path, item.op.newContent);
      setItemStatus(idx, "applied");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[FileChangeReview] writeTextFile failed:", msg, "path:", item.op.path);
      setItemStatus(idx, "error", msg);
    }
  };

  const rejectOne = (idx: number) => setItemStatus(idx, "rejected");

  const applyAll = async () => {
    setGlobalError(null);
    const snapshot = itemsRef.current;
    for (let i = 0; i < snapshot.length; i++) {
      if (snapshot[i].status === "pending") {
        await applyOne(i, snapshot[i]);
      }
    }
  };

  const pendingCount = items.filter((it) => it.status === "pending").length;
  const isAnyApplying = items.some((it) => it.status === "applying");

  if (items.length === 0) {
    return (
      <div style={overlayStyle}>
        <div style={panelStyle}>
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
            Loading diffs…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)", flexShrink: 0 }}>
          <div>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
              Proposed changes
            </span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginLeft: "var(--space-3)" }}>
              {items.length} file{items.length !== 1 ? "s" : ""}
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {pendingCount > 0 && (
              <button
                onClick={applyAll}
                disabled={isAnyApplying}
                style={{ ...applyAllBtnStyle, opacity: isAnyApplying ? 0.5 : 1 }}
              >
                {isAnyApplying ? "Applying…" : `Apply all (${pendingCount})`}
              </button>
            )}
            <button onClick={onClose} style={closeBtnStyle} title="Close">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l12 12M14 2L2 14" />
              </svg>
            </button>
          </div>
        </div>

        {/* Global error */}
        {globalError && (
          <div style={{ padding: "var(--space-2) var(--space-3)", background: "color-mix(in oklab, var(--color-error) 10%, var(--color-surface-2))", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", color: "var(--color-error)", marginBottom: "var(--space-3)", flexShrink: 0 }}>
            {globalError}
          </div>
        )}

        {/* File list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", overflow: "auto" }}>
          {items.map((item, idx) => (
            <FileOpCard
              key={item.op.path}
              item={item}
              expanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? -1 : idx)}
              onApply={() => applyOne(idx, item)}
              onReject={() => rejectOne(idx)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FileOpCard ────────────────────────────────────────────────────────────────

function FileOpCard({
  item, expanded, onToggle, onApply, onReject,
}: {
  item: FileReviewState;
  expanded: boolean;
  onToggle: () => void;
  onApply: () => void;
  onReject: () => void;
}) {
  const isNew        = item.oldContent === "";
  const addedLines   = item.diff.filter((l) => l.type === "added").length;
  const removedLines = item.diff.filter((l) => l.type === "removed").length;
  const isPending    = item.status === "pending";
  const isApplying   = item.status === "applying";
  const isApplied    = item.status === "applied";
  const isRejected   = item.status === "rejected";
  const isError      = item.status === "error";

  const statusColor =
    isApplied  ? "var(--color-success, #4ade80)" :
    isRejected ? "var(--color-text-muted)" :
    isError    ? "var(--color-error)" :
    "var(--color-text)";

  return (
    <div style={{
      border: `1px solid ${isPending || isApplying ? "oklch(from var(--color-text) l c h / 0.1)" : "transparent"}`,
      borderRadius: "var(--radius-md)",
      background: "var(--color-surface-2)",
      opacity: isRejected ? 0.5 : 1,
    }}>
      {/* Card header row */}
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", cursor: "pointer", userSelect: "none" }}
      >
        <span style={{ fontSize: "var(--text-xs)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--color-text-muted)", flexShrink: 0 }}>›</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: statusColor, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isApplied  && "✓ "}
          {isRejected && "✕ "}
          {isError    && "⚠ "}
          {isApplying && "⟳ "}
          {item.op.path}
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", flexShrink: 0 }}>
          {isNew ? (
            <span style={{ color: "var(--color-success, #4ade80)" }}>new file</span>
          ) : (
            <>
              {addedLines   > 0 && <span style={{ color: "var(--color-success, #4ade80)" }}>+{addedLines} </span>}
              {removedLines > 0 && <span style={{ color: "var(--color-error)" }}>-{removedLines}</span>}
            </>
          )}
        </span>
        {(isPending || isApplying) && (
          <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onApply(); }}
              disabled={isApplying}
              style={{ ...applyBtnStyle, opacity: isApplying ? 0.5 : 1 }}
            >
              {isApplying ? "…" : "Apply"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onReject(); }}
              disabled={isApplying}
              style={rejectBtnStyle}
            >
              Reject
            </button>
          </div>
        )}
      </div>

      {/* Inline error */}
      {isError && item.error && (
        <div style={{ padding: "var(--space-2) var(--space-4)", color: "var(--color-error)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", borderTop: "1px solid oklch(from var(--color-error) l c h / 0.2)" }}>
          {item.error}
          <button
            onClick={(e) => { e.stopPropagation(); onApply(); }}
            style={{ marginLeft: "var(--space-3)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Diff view */}
      {expanded && (
        <div style={{ borderTop: "1px solid oklch(from var(--color-text) l c h / 0.08)", overflow: "auto", maxHeight: 380 }}>
          <DiffView lines={item.diff} />
        </div>
      )}
    </div>
  );
}

// ── DiffView ──────────────────────────────────────────────────────────────────

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", lineHeight: 1.6, margin: 0, padding: "var(--space-3) 0", overflowX: "auto" }}>
      {lines.map((line, i) => {
        const bg =
          line.type === "added"   ? "color-mix(in oklab, #4ade80 12%, transparent)" :
          line.type === "removed" ? "color-mix(in oklab, var(--color-error) 12%, transparent)" :
          "transparent";
        const prefix =
          line.type === "added"   ? "+" :
          line.type === "removed" ? "-" : " ";
        const color =
          line.type === "added"   ? "#4ade80" :
          line.type === "removed" ? "var(--color-error)" :
          "var(--color-text-muted)";
        return (
          <div key={i} style={{ display: "flex", background: bg, paddingInline: "var(--space-4)" }}>
            <span style={{ color, width: 14, flexShrink: 0, userSelect: "none" }}>{prefix}</span>
            <span style={{ color: line.type === "unchanged" ? "var(--color-text-muted)" : "var(--color-text)", whiteSpace: "pre", flex: 1 }}>
              {line.content}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "oklch(from var(--color-bg) l c h / 0.85)",
  backdropFilter: "blur(4px)",
  zIndex: 50,
  display: "flex",
  alignItems: "flex-end",
  padding: "var(--space-4)",
};

const panelStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-surface)",
  border: "1px solid oklch(from var(--color-text) l c h / 0.12)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-5)",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  gap: 0,
};

const applyAllBtnStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-4)",
  background: "var(--color-primary)",
  color: "#fff",
  borderRadius: "var(--radius-full)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  cursor: "pointer",
};

const applyBtnStyle: React.CSSProperties = {
  padding: "1px var(--space-3)",
  background: "var(--color-primary)",
  color: "#fff",
  borderRadius: "var(--radius-full)",
  fontSize: "var(--text-xs)",
  cursor: "pointer",
};

const rejectBtnStyle: React.CSSProperties = {
  padding: "1px var(--space-3)",
  background: "var(--color-surface-3)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-full)",
  fontSize: "var(--text-xs)",
  cursor: "pointer",
};

const closeBtnStyle: React.CSSProperties = {
  padding: "var(--space-1)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
