/**
 * useGraphStore — derives ReactFlow nodes + edges from the active WorkflowRun.
 *
 * Responsibilities:
 *  - Subscribe to useAppStore.activeRun
 *  - On each change, build layouted RF nodes + edges via buildRunGraph()
 *  - Expose { nodes, edges } for WorkflowGraph to consume
 *
 * Layout: dagre, left-to-right not needed here — top-to-bottom (TB) is cleaner
 * for agent chains that grow downward.
 */

import { create } from "zustand";
import {
  type Node,
  type Edge,
  Position,
} from "@xyflow/react";
import dagre from "dagre";
import { useAppStore } from "./useAppStore";
import type { WorkflowRun, WorkflowStep } from "@/types";
import type { AgentNodeData } from "@/components/WorkflowGraph/AgentNode";
import type { EdgeWithLabelData } from "@/components/WorkflowGraph/EdgeWithLabel";

const NODE_W = 220;
const NODE_H = 90;  // approximate; dagre uses this for spacing

// ── Layout ───────────────────────────────────────────────────────────────────

export function layoutGraph(
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  const laid = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
    };
  });

  return { nodes: laid, edges };
}

// ── Run → RF graph ──────────────────────────────────────────────────────────

function buildRunGraph(run: WorkflowRun): { nodes: Node[]; edges: Edge[] } {
  const raw: Node[] = [];
  const rawEdges: Edge[] = [];

  // Collect unique agent IDs in order (deduplicate sequential repeats)
  const chain: string[] = [];
  for (const step of run.steps) {
    if (chain[chain.length - 1] !== step.agentId) {
      chain.push(step.agentId);
    }
  }

  // Build status map: last step per agentId wins
  const statusMap = new Map<string, WorkflowStep["status"]>();
  const outputMap = new Map<string, string>();
  for (const step of run.steps) {
    statusMap.set(step.agentId, step.status);
    if (step.output) outputMap.set(step.agentId, step.output);
  }

  chain.forEach((agentId) => {
    const status = statusMap.get(agentId) ?? "pending";
    const output = outputMap.get(agentId);
    raw.push({
      id: agentId,
      type: "agent",
      position: { x: 0, y: 0 },
      data: {
        label: agentId,
        status,
        outputPreview: output ? output.slice(0, 80) + (output.length > 80 ? "…" : "") : undefined,
      } satisfies AgentNodeData,
    });
  });

  chain.forEach((agentId, i) => {
    if (i === 0) return;
    const source = chain[i - 1];
    const sourceStatus = statusMap.get(source) ?? "pending";
    const targetStatus = statusMap.get(agentId) ?? "pending";
    const isActive =
      sourceStatus === "done" &&
      (targetStatus === "running" || targetStatus === "pending");

    // Get context mode from the first step matching this agent pair
    const stepForTarget = run.steps.find((s) => s.agentId === agentId);
    const label = stepForTarget?.contextMode !== "none"
      ? stepForTarget?.contextMode
      : undefined;

    rawEdges.push({
      id: `${source}->${agentId}`,
      source,
      target: agentId,
      type: "labeled",
      data: { label, animated: isActive } satisfies EdgeWithLabelData,
    });
  });

  return layoutGraph(raw, rawEdges);
}

// ── Zustand store ─────────────────────────────────────────────────────────────

interface GraphState {
  nodes: Node[];
  edges: Edge[];
  _setGraph: (n: Node[], e: Edge[]) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  _setGraph: (nodes, edges) => set({ nodes, edges }),
}));

// Subscribe to activeRun changes and rebuild graph
useAppStore.subscribe(
  (state) => state.activeRun,
  (run) => {
    if (!run) {
      useGraphStore.getState()._setGraph([], []);
      return;
    }
    const { nodes, edges } = buildRunGraph(run);
    useGraphStore.getState()._setGraph(nodes, edges);
  }
);
