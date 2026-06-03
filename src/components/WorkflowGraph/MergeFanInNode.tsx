/**
 * MergeFanInNode — fan-in footer node for a parallel agent group.
 *
 * Sits below the per-agent leaf nodes and shows:
 *   - Merge strategy pill (concat / summarise / vote)
 *   - succeeded / total agent count
 *   - Merged output preview (first 80 chars)
 *
 * Handles: target (top) + source (bottom)
 */

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { MergeStrategy } from '@/types';
import styles from './MergeFanInNode.module.css';

export type MergeFanInNodeData = {
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted';
  strategy: MergeStrategy;
  succeededCount: number;
  totalCount: number;
  outputPreview?: string;
};

export const MergeFanInNode = memo(function MergeFanInNode({
  data,
  selected,
}: NodeProps<Node<MergeFanInNodeData>>) {
  const { label, status, strategy, succeededCount, totalCount, outputPreview } = data;
  const allFailed = succeededCount === 0;
  const someFailed = succeededCount < totalCount;

  return (
    <div
      className={[
        styles.node,
        styles[`status_${status}`],
        selected ? styles.selected : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="article"
      aria-label={`Merge: ${label}, ${succeededCount}/${totalCount} succeeded`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={styles.handle}
        isConnectable={false}
      />

      {/* Header row */}
      <div className={styles.header}>
        {/* Converge icon */}
        <span className={styles.icon} aria-hidden>
          <svg
            width="14" height="14" viewBox="0 0 16 16"
            fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round"
          >
            {/* Three converging lines */}
            <path d="M3 3 L8 9" />
            <path d="M8 3 L8 9" />
            <path d="M13 3 L8 9" />
            {/* Centre stem down */}
            <line x1="8" y1="9" x2="8" y2="14" />
          </svg>
        </span>

        <span className={styles.name}>{label}</span>

        {/* Strategy pill */}
        <span className={`${styles.strategyPill} ${styles[`strategy_${strategy}`]}`}>
          {strategy}
        </span>
      </div>

      {/* Count row */}
      <div className={styles.countRow}>
        <span
          className={[
            styles.count,
            allFailed  ? styles.countFail :
            someFailed ? styles.countWarn :
            styles.countOk,
          ].join(' ')}
        >
          {succeededCount}/{totalCount} ok
        </span>
      </div>

      {/* Merged output preview */}
      {outputPreview && (
        <p className={styles.output}>{outputPreview}</p>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className={styles.handle}
        isConnectable={false}
      />
    </div>
  );
});
