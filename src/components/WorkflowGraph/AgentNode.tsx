/**
 * AgentNode — custom ReactFlow node for a single agent step.
 *
 * Visual states:
 *   pending  → muted border, grey dot
 *   running  → teal border + animated pulse ring
 *   done     → green border
 *   error    → red border + error icon
 *   aborted  → grey border, reduced opacity
 *   static   → no status (agent graph preview)
 */

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import styles from "./AgentNode.module.css";

export type AgentNodeData = {
  label: string;
  model?: string;
  status?: "pending" | "running" | "done" | "error" | "aborted";
  /** True when this agent is in a static (no-run) preview. */
  isStatic?: boolean;
  /** Shortened output preview (first 80 chars). */
  outputPreview?: string;
  description?: string;
};

export const AgentNode = memo(function AgentNode({
  data,
  selected,
}: NodeProps<Node<AgentNodeData>>) {
  const { label, model, status, isStatic, outputPreview, description } = data;

  return (
    <div
      className={[
        styles.node,
        status ? styles[`status_${status}`] : styles.status_static,
        selected ? styles.selected : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="article"
      aria-label={`Agent: ${label}${ status ? `, status: ${status}` : ""}`}
    >
      {/* Pulse ring on running */}
      {status === "running" && <span className={styles.pulseRing} aria-hidden />}

      {/* Top handle (incoming edges) */}
      <Handle
        type="target"
        position={Position.Top}
        className={styles.handle}
        isConnectable={false}
      />

      {/* Node body */}
      <div className={styles.header}>
        <span className={styles.dot} aria-hidden />
        <span className={styles.name}>{label}</span>
        {status && status !== "pending" && (
          <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
            {status}
          </span>
        )}
      </div>

      {model && (
        <span className={styles.model}>{model}</span>
      )}

      {isStatic && description && (
        <p className={styles.description}>{description}</p>
      )}

      {outputPreview && (
        <p className={styles.output}>{outputPreview}</p>
      )}

      {/* Bottom handle (outgoing edges) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={styles.handle}
        isConnectable={false}
      />
    </div>
  );
});
