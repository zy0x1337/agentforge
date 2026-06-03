/**
 * WorkflowGraph — ReactFlow-based visualization of a WorkflowRun.
 *
 * Node types
 * ──────────
 * agent        — single sequential agent step (AgentNode)
 * parallelHub  — fan-out header of a parallel group (ParallelHubNode)
 * mergeFanIn   — fan-in footer of a parallel group (MergeFanInNode)
 *
 * Edge types
 * ──────────
 * labeled      — animated edge with optional context-mode label (EdgeWithLabel)
 */

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useState } from 'react';
import { AgentNode }        from './AgentNode';
import { ParallelHubNode }  from './ParallelHubNode';
import { MergeFanInNode }   from './MergeFanInNode';
import { EdgeWithLabel }    from './EdgeWithLabel';
import { useGraphStore }    from '@/store/useGraphStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAppStore }      from '@/store/useAppStore';
import { useHistoryStore }  from '@/store/useHistoryStore';
import { buildStaticGraph } from '@/lib/graphLayout';
import styles from './WorkflowGraph.module.css';

// ── Custom type registrations (defined outside render — stable references) ──

const NODE_TYPES: NodeTypes = {
  agent:       AgentNode,
  parallelHub: ParallelHubNode,
  mergeFanIn:  MergeFanInNode,
};

const EDGE_TYPES: EdgeTypes = {
  labeled: EdgeWithLabel,
};

// ── Inner component (needs ReactFlowProvider context) ───────────────────────

function GraphInner() {
  const { fitView } = useReactFlow();
  const { nodes, edges } = useGraphStore();
  const { activeRun }    = useWorkflowStore();
  const { activeRunId, runs: history } = useHistoryStore();
  const { agents }       = useAppStore();

  const [showMinimap, setShowMinimap] = useState(true);

  // Fit view whenever the layout changes
  useEffect(() => {
    const id = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
    return () => cancelAnimationFrame(id);
  }, [nodes, fitView]);

  // Derive which run to display
  const displayRun =
    activeRun ??
    history.find((r) => r.id === activeRunId) ??
    null;

  // Static preview: render agent connections from frontmatter when no run is shown
  const staticGraph = !displayRun && agents.length > 0
    ? buildStaticGraph(agents)
    : null;

  const displayNodes = displayRun ? nodes : (staticGraph?.nodes ?? []);
  const displayEdges = displayRun ? edges : (staticGraph?.edges ?? []);

  const isEmpty = displayNodes.length === 0;

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>
          {displayRun
            ? `Run · ${displayRun.status === 'running' ? 'live' : displayRun.status}`
            : 'Agent graph'}
        </span>
        <div className={styles.toolbarActions}>
          <button
            className={styles.toolBtn}
            onClick={() => fitView({ padding: 0.2, duration: 400 })}
            title="Fit view"
            aria-label="Fit view"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5" />
            </svg>
          </button>
          <button
            className={`${styles.toolBtn} ${showMinimap ? styles.toolBtnActive : ''}`}
            onClick={() => setShowMinimap((v) => !v)}
            title="Toggle minimap"
            aria-label="Toggle minimap"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="1" y="1" width="14" height="14" rx="2" />
              <rect x="3" y="7" width="5" height="6" rx="1" />
              <rect x="9" y="3" width="4" height="4" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className={styles.empty}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text-faint)" strokeWidth="1.2" strokeLinecap="round">
            <circle cx="8"  cy="16" r="4" />
            <circle cx="24" cy="8"  r="4" />
            <circle cx="24" cy="24" r="4" />
            <path d="M12 14.5l8-5M12 17.5l8 5" />
          </svg>
          <p>No agents loaded yet.</p>
          <p>Open an agents directory in the Agents panel.</p>
        </div>
      )}

      {/* ReactFlow canvas */}
      {!isEmpty && (
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className={styles.canvas}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--border)"
          />
          <Controls showInteractive={false} className={styles.rfControls} />
          {showMinimap && (
            <MiniMap
              nodeColor={minimapNodeColor}
              maskColor="oklch(0 0 0 / 0.35)"
              className={styles.minimap}
            />
          )}
        </ReactFlow>
      )}
    </div>
  );
}

function minimapNodeColor(node: { type?: string; data: { status?: string } }) {
  // Hub and merge nodes get distinct minimap tints
  if (node.type === 'parallelHub' || node.type === 'mergeFanIn') {
    switch (node.data?.status) {
      case 'running': return 'var(--warning)';
      case 'done':    return 'var(--success)';
      case 'error':   return 'var(--error)';
      default:        return 'var(--primary)';
    }
  }
  switch (node.data?.status) {
    case 'running':  return 'var(--warning)';
    case 'done':     return 'var(--success)';
    case 'error':    return 'var(--error)';
    case 'aborted':  return 'var(--text-faint)';
    default:         return 'var(--surface-dynamic)';
  }
}

// ── Public export ────────────────────────────────────────────────────────────

export function WorkflowGraph() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
