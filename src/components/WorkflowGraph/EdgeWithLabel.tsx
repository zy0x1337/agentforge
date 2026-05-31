/**
 * EdgeWithLabel — custom ReactFlow edge that shows context_mode as a label
 * on the animated path between two agent nodes.
 *
 * Active edges (source node = done, target = running or pending) are drawn
 * with a teal animated dash; inactive edges use a muted stroke.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import styles from "./EdgeWithLabel.module.css";

export interface EdgeWithLabelData {
  label?: string;         // context mode: "full" | "summary" | "none"
  animated?: boolean;     // true when source is done / target is running
}

export function EdgeWithLabel({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<EdgeWithLabelData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const isActive = data?.animated ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={isActive ? styles.edgeActive : styles.edgeMuted}
        markerEnd="url(#arrow)"
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <span
            className={`${styles.label} ${isActive ? styles.labelActive : ""}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
