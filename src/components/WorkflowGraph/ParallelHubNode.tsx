/**
 * ParallelHubNode — fan-out entry node for a parallel agent group.
 *
 * Rendered by useGraphStore as `type: "parallelHub"` when a WorkflowStep
 * has a parallelGroup. Sits above the per-agent leaf nodes and shows:
 *   - Number of agents in the group
 *   - Current group status (pending / running / done / error)
 *   - Animated split icon while running
 *
 * Handles: target (top) + source (bottom)
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { MergeStrategy } from '@/types';
import styles from './ParallelHubNode.module.css';

export interface ParallelHubNodeData {
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted';
  strategy?: MergeStrategy;
  agentCount?: number;
}

export const ParallelHubNode = memo(function ParallelHubNode({
  data,
  selected,
}: NodeProps<ParallelHubNodeData>) {
  const { label, status, strategy } = data;
  const isRunning = status === 'running';

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
      aria-label={`Parallel group: ${label}, status: ${status}`}
    >
      {isRunning && <span className={styles.pulseRing} aria-hidden />}

      <Handle
        type="target"
        position={Position.Top}
        className={styles.handle}
        isConnectable={false}
      />

      <div className={styles.inner}>
        {/* Split icon */}
        <span className={styles.icon} aria-hidden>
          <svg
            width="16" height="16" viewBox="0 0 16 16"
            fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round"
            className={isRunning ? styles.iconSpin : ''}
          >
            {/* Centre stem down */}
            <line x1="8" y1="2" x2="8" y2="7" />
            {/* Three diverging lines */}
            <path d="M8 7 L3 13" />
            <path d="M8 7 L8 13" />
            <path d="M8 7 L13 13" />
          </svg>
        </span>

        <div className={styles.text}>
          <span className={styles.name}>{label}</span>
          {strategy && (
            <span className={styles.strategy}>{strategy}</span>
          )}
        </div>

        {/* Status badge */}
        {status !== 'pending' && (
          <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
            {status}
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className={styles.handle}
        isConnectable={false}
      />
    </div>
  );
});
