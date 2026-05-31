/**
 * WorkflowGraph — ReactFlow-based visualization of a WorkflowRun.
 *
 * Features:
 *  - Custom AgentNode showing name, model, status badge
 *  - Animated pulse ring on the currently running node
 *  - Animated edge with label (context mode) for active transitions
 *  - Auto-layout via dagre (top-to-bottom)
 *  - Toolbar: fit-view, zoom in/out, minimap toggle
 *  - Static preview mode: renders agent graph from frontmatter when no run is active
 *
 * Dependencies (add to package.json):
 *   @xyflow/react  ^12
 *   dagre          ^0.8
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useState } from "react";
import { AgentNode } from "./AgentNode";
import { EdgeWithLabel } from "./EdgeWithLabel";
import { useGraphStore } from "@/store/useGraphStore";
import { useAppStore } from "@/store/useAppStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { buildStaticGraph } from "@/lib/graphLayout";
import styles from "./WorkflowGraph.module.css";

// Register custom node and edge types outside render to avoid re-registration
const NODE_TYPES: NodeTypes = { agent: AgentNode };
const EDGE_TYPES: EdgeTypes = { labeled: EdgeWithLabel };

// ── Inner component (needs ReactFlowProvider context) ───────────────────────

function GraphInner() {
  const { fitView } = useReactFlow();
  const { nodes, edges } = useGraphStore();
  const { activeRun } = useAppStore();
  const { activeRunId, history } = useHistoryStore();
  const { agents } = useAppStore();

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

  // Static graph: render agent connections from frontmatter when no run is shown
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
            ? `Run · ${displayRun.status === "running" ? "live" : displayRun.status}`
            : "Agent graph"}
        </span>
        <div className={styles.toolbarActions}>
          <button
            className={styles.toolBtn}
            onClick={() => fitView({ padding: 0.2, duration: 400 })}
            title="Fit view"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5" />
            </svg>
          </button>
          <button
            className={`${styles.toolBtn} ${showMinimap ? styles.toolBtnActive : ""}`}
            onClick={() => setShowMinimap((v) => !v)}
            title="Toggle minimap"
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
            <circle cx="8" cy="16" r="4" />
            <circle cx="24" cy="8" r="4" />
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

function minimapNodeColor(node: { data: { status?: string } }) {
  switch (node.data?.status) {
    case "running":  return "var(--warning)";
    case "done":     return "var(--success)";
    case "error":    return "var(--error)";
    case "aborted":  return "var(--text-faint)";
    default:         return "var(--surface-dynamic)";
  }
}

// ── Public export (wraps with Provider) ─────────────────────────────────────

export function WorkflowGraph() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
