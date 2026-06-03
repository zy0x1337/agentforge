/**
 * FileChangeReview — shows agent-proposed file writes as diffs before
 * applying them. Each op can be approved or rejected individually.
 * Nothing is written to disk until the user confirms.
 */

import { useState, useEffect } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  diffLines,
  collapseDiff,
  type FileWriteOp,
  type DiffLine,
} from "@/lib/contextFiles";

interface FileReviewState {
  op: FileWriteOp;
  oldContent: string;
  diff: DiffLine[];
  status: "pending" | "applied" | "rejected";
}

interface Props {
  ops: FileWriteOp[];
  onClose: () => void;
}

export function FileChangeReview({ ops, onClose }: Props) {
  const [items, setItems] = useState<FileReviewState[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number>(0);
  const [applying, setApplying] = useState(false);

  // Load current file contents + compute diffs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const states = await Promise.all(
        ops.map(async (op) => {
          const oldContent = await readTextFile(op.path).catch(() => "");
          const raw = diffLines(oldContent, op.newContent);
          const diff = collapseDiff(raw);
          return { op, oldContent, diff, status: "pending" as const };
        }),
      );
      if (!cancelled) setItems(states);
    })();
    return () => { cancelled = true; };
  }, [ops]);

  const pendingCount = items.filter((it) => it.status === "pending").length;

  const applyOne = async (idx: number) => {
    const item = items[idx];
    if (!item || item.status !== "pending") return;
    setApplying(true);
    try {
      await writeTextFile(item.op.path, item.op.newContent);
      setItems((prev) =>
        prev.map((it, i) => (i === idx ? { ...it, status: "applied" } : it)),
      );
    } catch (err) {
      alert(`Failed to write ${item.op.path}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(false);
    }
  };

  const rejectOne = (idx: number) => {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, status: "rejected" } : it)),
    );
  };

  const applyAll = async () => {
    setApplying(true);
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "pending") await applyOne(i);
    }
    setApplying(false);
  };

  if (items.length === 0) {
    return (
      <div style={overlayStyle}>
        <div style={panelStyle}>
          <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>Loading diffs…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
          <div>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
              Proposed changes
            </span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginLeft: "var(--space-3)" }}>
              {pendingCount} pending · {items.length} total
            </span>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {pendingCount > 0 && (
              <button
                onClick={applyAll}
                disabled={applying}
                style={applyAllBtnStyle}
              >
                Apply all ({pendingCount})
              </button>
            )}
            <button onClick={onClose} style={closeBtnStyle} title="Close">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l12 12M14 2L2 14" />
              </svg>
            </button>
          </div>
        </div>

        {/* File list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", overflow: "auto", maxHeight: "calc(80vh - 120px)" }}>
          {items.map((item, idx) => (
            <FileOpCard
              key={item.op.path}
              item={item}
              expanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? -1 : idx)}
              onApply={() => applyOne(idx)}
              onReject={() => rejectOne(idx)}
              applying={applying}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FileOpCard ────────────────────────────────────────────────────────────────

function FileOpCard({
  item,
  expanded,
  onToggle,
  onApply,
  onReject,
  applying,
}: {
  item: FileReviewState;
  expanded: boolean;
  onToggle: () => void;
  onApply: () => void;
  onReject: () => void;
  applying: boolean;
}) {
  const isNew = item.oldContent === "";
  const addedLines   = item.diff.filter((l) => l.type === "added").length;
  const removedLines = item.diff.filter((l) => l.type === "removed").length;

  const statusColor =
    item.status === "applied"  ? "var(--color-success, #4ade80)" :
    item.status === "rejected" ? "var(--color-text-muted)" :
    "var(--color-text)";

  return (
    <div style={{
      border: `1px solid ${item.status === "pending" ? "oklch(from var(--color-text) l c h / 0.1)" : "transparent"}`,
      borderRadius: "var(--radius-md)",
      background: "var(--color-surface-2)",
      opacity: item.status === "rejected" ? 0.5 : 1,
    }}>
      {/* Card header */}
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", cursor: "pointer" }}
      >
        <span style={{ fontSize: "var(--text-xs)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--color-text-muted)" }}>›</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: statusColor, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.status === "applied"  && "✓ "}
          {item.status === "rejected" && "✕ "}
          {item.op.path}
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", flexShrink: 0 }}>
          {isNew ? (
            <span style={{ color: "var(--color-success, #4ade80)" }}>new file</span>
          ) : (
            <>
              {addedLines > 0 && <span style={{ color: "var(--color-success, #4ade80)" }}>+{addedLines} </span>}
              {removedLines > 0 && <span style={{ color: "var(--color-error)" }}>-{removedLines}</span>}
            </>
          )}
        </span>
        {item.status === "pending" && (
          <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onApply(); }}
              disabled={applying}
              style={applyBtnStyle}
            >
              Apply
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onReject(); }}
              style={rejectBtnStyle}
            >
              Reject
            </button>
          </div>
        )}
      </div>

      {/* Diff view */}
      {expanded && (
        <div style={{ borderTop: "1px solid oklch(from var(--color-text) l c h / 0.08)", overflow: "auto", maxHeight: 400 }}>
          <DiffView lines={item.diff} />
        </div>
      )}
    </div>
  );
}

// ── DiffView ──────────────────────────────────────────────────────────────────

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre style={{
      fontFamily: "var(--font-mono)",
      fontSize: "0.7rem",
      lineHeight: 1.6,
      margin: 0,
      padding: "var(--space-3) 0",
      overflowX: "auto",
    }}>
      {lines.map((line, i) => {
        const bg =
          line.type === "added"   ? "color-mix(in oklab, #4ade80 12%, transparent)" :
          line.type === "removed" ? "color-mix(in oklab, var(--color-error) 12%, transparent)" :
          "transparent";
        const prefix =
          line.type === "added"   ? "+" :
          line.type === "removed" ? "-" :
          " ";
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
};

const applyAllBtnStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-4)",
  background: "var(--color-primary)",
  color: "#fff",
  borderRadius: "var(--radius-full)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
};

const applyBtnStyle: React.CSSProperties = {
  padding: "1px var(--space-3)",
  background: "var(--color-primary)",
  color: "#fff",
  borderRadius: "var(--radius-full)",
  fontSize: "var(--text-xs)",
};

const rejectBtnStyle: React.CSSProperties = {
  padding: "1px var(--space-3)",
  background: "var(--color-surface-3)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-full)",
  fontSize: "var(--text-xs)",
};

const closeBtnStyle: React.CSSProperties = {
  padding: "var(--space-1)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-sm)",
};
