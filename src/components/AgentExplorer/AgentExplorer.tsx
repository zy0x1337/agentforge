/**
 * AgentExplorer — left-panel agent list + right-panel detail / editor.
 *
 * Selecting an agent now loads it into useEditorStore and renders
 * <AgentEditor> instead of the old read-only <pre> blocks.
 */
import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/useAppStore";
import { loadAgents, createAgent } from "@/lib/agentFs";
import { useEditorStore } from "@/components/AgentEditor/useEditorStore";
import { AgentEditor } from "@/components/AgentEditor/AgentEditor";
import type { Agent } from "@/types";

export default function AgentExplorer() {
  const { agents, setAgents, selectedAgent, selectAgent, settings, updateSettings } =
    useAppStore();
  const { loadAgent } = useEditorStore();
  const [newName, setNewName] = useState("");

  // Load agent files into editor whenever selection changes
  useEffect(() => {
    if (selectedAgent?.path) {
      loadAgent(selectedAgent.path);
    }
  }, [selectedAgent?.path, loadAgent]);

  const openFolder = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Select Agents Folder" });
    if (typeof dir === "string") {
      updateSettings({ agentsDir: dir });
      const loaded = await loadAgents(dir).catch(() => []);
      setAgents(loaded);
    }
  };

  const addAgent = async () => {
    if (!newName || !settings.agentsDir) return;
    await createAgent(settings.agentsDir, newName);
    const loaded = await loadAgents(settings.agentsDir);
    setAgents(loaded);
    setNewName("");
  };

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Agent list */}
      <div style={{
        width: 220,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Agents {agents.length > 0 && `(${agents.length})`}
            </span>
            <button onClick={openFolder} title="Open agents folder" style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>⊕</button>
          </div>
          {settings.agentsDir && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {settings.agentsDir.split(/[\\/]/).pop()}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "var(--space-3) var(--space-2)" }}>
          {!settings.agentsDir ? (
            <div style={{ padding: "var(--space-4)", textAlign: "center" }}>
              <p style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", marginBottom: "var(--space-3)" }}>No folder selected</p>
              <button
                onClick={openFolder}
                style={{ padding: "var(--space-2) var(--space-4)", background: "var(--primary)", color: "#fff", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)" }}
              >
                Open Agents Folder
              </button>
            </div>
          ) : agents.length === 0 ? (
            <p style={{ padding: "var(--space-4)", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>No agents found. Create one below.</p>
          ) : (
            agents.map((agent) => (
              <AgentItem
                key={agent.id}
                agent={agent}
                selected={selectedAgent?.id === agent.id}
                onSelect={selectAgent}
              />
            ))
          )}
        </div>

        {settings.agentsDir && (
          <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border)", display: "flex", gap: "var(--space-2)" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAgent()}
              placeholder="New agent name…"
              style={{ flex: 1, padding: "var(--space-2)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", color: "var(--text)" }}
            />
            <button
              onClick={addAgent}
              style={{ padding: "var(--space-2) var(--space-3)", background: "var(--primary)", color: "#fff", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)" }}
            >+</button>
          </div>
        )}
      </div>

      {/* Editor / empty state */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {!selectedAgent ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-3)", color: "var(--text-muted)" }}>
            <span style={{ fontSize: "2rem" }}>◈</span>
            <p style={{ fontSize: "var(--text-sm)" }}>Select an agent to edit</p>
          </div>
        ) : (
          <AgentEditor />
        )}
      </div>
    </div>
  );
}

function AgentItem({
  agent, selected, onSelect,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: (a: Agent) => void;
}) {
  return (
    <button
      onClick={() => onSelect(agent)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "var(--space-3)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: selected ? "var(--surface-3)" : "transparent",
        color: "var(--text)",
        transition: "var(--transition)",
      }}
    >
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
        {agent.frontmatter.name}
      </span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {agent.frontmatter.description || agent.id}
      </span>
      {agent.frontmatter.model && (
        <span style={{ fontSize: "0.65rem", color: "var(--primary)", fontFamily: "var(--font-mono)" }}>
          {agent.frontmatter.model}
        </span>
      )}
    </button>
  );
}
