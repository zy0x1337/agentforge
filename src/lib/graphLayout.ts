/**
 * graphLayout.ts
 *
 * Builds a static ReactFlow graph from agent frontmatter.
 * Used by WorkflowGraph when no WorkflowRun is active — shows
 * the agent dependency graph as defined by next_agents fields.
 *
 * Also re-exports layoutGraph for use outside the store.
 */

import type { Node, Edge } from "@xyflow/react";
import type { Agent } from "@/types";
import { layoutGraph } from "@/store/useGraphStore";
import type { AgentNodeData } from "@/components/WorkflowGraph/AgentNode";
import type { EdgeWithLabelData } from "@/components/WorkflowGraph/EdgeWithLabel";

export { layoutGraph };

export function buildStaticGraph(
  agents: Agent[]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = agents.map((a) => ({
    id: a.id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      label: a.frontmatter.name,
      model: a.frontmatter.model,
      description: a.frontmatter.description,
      isStatic: true,
    } satisfies AgentNodeData,
  }));

  const edges: Edge[] = [];
  const agentIds = new Set(agents.map((a) => a.id));

  for (const agent of agents) {
    for (const targetId of agent.frontmatter.next_agents ?? []) {
      if (!agentIds.has(targetId)) continue; // skip unresolved refs
      edges.push({
        id: `${agent.id}->${targetId}`,
        source: agent.id,
        target: targetId,
        type: "labeled",
        data: { label: undefined, animated: false } satisfies EdgeWithLabelData,
      });
    }
  }

  return layoutGraph(nodes, edges);
}
