/**
 * useGraphStore — derives ReactFlow nodes + edges from the active WorkflowRun.
 *
 * Parallel group support
 * ──────────────────────
 * When a WorkflowStep has a parallelGroup, we render:
 *
 *   [prev sequential node]
 *          │
 *       [HUB node]  ← "parallel group" node, type: "parallelHub"
 *       /   |   \
 *    [A]   [B]   [C]  ← per-agent leaf nodes, type: "agent"
 *       \   |   /
 *       [MERGE node]  ← fan-in merge node, type: "mergeFanIn"
 *          │
 *   [next sequential node]
 *
 * All hub/merge nodes get synthetic IDs: `pg-hub-{runIdx}` / `pg-merge-{runIdx}`.
 * Edges to/from parallel agents are animated while the group is running.
 */

import { create } from 'zustand';
import { type Node, type Edge, Position } from '@xyflow/react';
import dagre from 'dagre';
import { useWorkflowStore } from './useWorkflowStore';
import type { WorkflowRun } from '@/types';
import type { AgentNodeData } from '@/components/WorkflowGraph/AgentNode';
import type { EdgeWithLabelData } from '@/components/WorkflowGraph/EdgeWithLabel';

const NODE_W = 220;
const NODE_H = 90;

// ── Layout ───────────────────────────────────────────────────────────────────

export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 64 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        ...n,
        position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
      };
    }),
    edges,
  };
}

// ── Run → RF graph ───────────────────────────────────────────────────────────

export function buildRunGraph(run: WorkflowRun): { nodes: Node[]; edges: Edge[] } {
  const raw:      Node[] = [];
  const rawEdges: Edge[] = [];

  /**
   * The "connection point" for the previous step.
   * For sequential agents it's the agentId.
   * For parallel groups it's the merge-fanin node id.
   */
  let prevId: string | undefined;

  run.steps.forEach((step, stepIdx) => {

    // ── Parallel group step ──────────────────────────────────────────────────
    if (step.parallelGroup) {
      const pg       = step.parallelGroup;
      const hubId    = `pg-hub-${stepIdx}`;
      const mergeId  = `pg-merge-${stepIdx}`;
      const isRunning = step.status === 'running';
      const isDone    = step.status === 'done';

      // Hub node
      raw.push({
        id: hubId,
        type: 'parallelHub',
        position: { x: 0, y: 0 },
        data: {
          label: `Parallel (${pg.agentIds.length})`,
          status: step.status,
          strategy: pg.strategy,
        },
      });

      // Edge: prev → hub
      if (prevId) {
        rawEdges.push(makeEdge(prevId, hubId, { animated: isRunning }));
      }

      // Per-agent leaf nodes + hub → agent edges
      pg.agentIds.forEach((agentId) => {
        const agentResult = pg.results.find((r) => r.agentId === agentId);
        const agentStatus = agentResult
          ? agentResult.status === 'ok' ? 'done' : agentResult.status
          : isRunning ? 'running' : 'pending';
        const preview = agentResult?.output
          ? agentResult.output.slice(0, 80) + (agentResult.output.length > 80 ? '…' : '')
          : undefined;

        raw.push({
          id: `${hubId}-${agentId}`,
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            label: agentId,
            status: agentStatus as AgentNodeData['status'],
            outputPreview: preview,
          } satisfies AgentNodeData,
        });

        rawEdges.push(makeEdge(hubId, `${hubId}-${agentId}`, { animated: isRunning }));
        rawEdges.push(makeEdge(`${hubId}-${agentId}`, mergeId, { animated: isRunning }));
      });

      // Merge (fan-in) node
      raw.push({
        id: mergeId,
        type: 'mergeFanIn',
        position: { x: 0, y: 0 },
        data: {
          label: `Merge · ${pg.strategy}`,
          status: isDone ? 'done' : step.status,
          succeededCount: pg.succeededCount,
          totalCount:     pg.agentIds.length,
          outputPreview:  pg.mergedOutput
            ? pg.mergedOutput.slice(0, 80) + (pg.mergedOutput.length > 80 ? '…' : '')
            : undefined,
        },
      });

      prevId = mergeId;
      return;
    }

    // ── Sequential step ──────────────────────────────────────────────────────
    if (!step.agentId) return;

    raw.push({
      id: step.agentId,
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label:         step.agentId,
        status:        step.status as AgentNodeData['status'],
        outputPreview: step.output
          ? step.output.slice(0, 80) + (step.output.length > 80 ? '…' : '')
          : undefined,
      } satisfies AgentNodeData,
    });

    if (prevId) {
      rawEdges.push(makeEdge(prevId, step.agentId, {
        label:    step.contextMode !== 'none' ? step.contextMode : undefined,
        animated: step.status === 'running',
      }));
    }

    prevId = step.agentId;
  });

  return layoutGraph(raw, rawEdges);
}

// ── Edge factory ─────────────────────────────────────────────────────────────

function makeEdge(
  source: string,
  target: string,
  opts: { animated?: boolean; label?: string } = {},
): Edge {
  return {
    id:       `${source}->${target}`,
    source,
    target,
    type:     'labeled',
    data:     { label: opts.label, animated: opts.animated ?? false } satisfies EdgeWithLabelData,
  };
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
useWorkflowStore.subscribe(
  (state) => state.activeRun,
  (run) => {
    if (!run) {
      useGraphStore.getState()._setGraph([], []);
      return;
    }
    const { nodes, edges } = buildRunGraph(run);
    useGraphStore.getState()._setGraph(nodes, edges);
  },
);
