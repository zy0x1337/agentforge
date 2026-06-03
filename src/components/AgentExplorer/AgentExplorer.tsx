import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/useAppStore";
import { loadAgents, createAgent, deleteAgent } from "@/lib/agentFs";
import { useEditorStore } from "@/components/AgentEditor/useEditorStore";
import { AgentEditor } from "@/components/AgentEditor/AgentEditor";
import type { Agent } from "@/types";

export default function AgentExplorer() {
  const { agents, setAgents, selectedAgent, selectAgent, settings, updateSettings } =
    useAppStore();
  const { loadAgent, lastSaved } = useEditorStore();
  const [newName, setNewName]         = useState("");
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);

  useEffect(() => {
    if (selectedAgent?.path) loadAgent(selectedAgent.path);
  }, [selectedAgent?.path, loadAgent]);

  // Reload agents whenever any file is saved so the store stays fresh
  useEffect(() => {
    if (!lastSaved || !settings.agentsDir) return;
    loadAgents(settings.agentsDir).then(setAgents).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSaved]);

  const openFolder = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Select Agents Folder" });
    if (typeof dir === "string") {
      updateSettings({ agentsDir: dir });
      setLoadError(null);
      try {
        setAgents(await loadAgents(dir));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
        setAgents([]);
      }
    }
  };

  const addAgent = async () => {
    if (!newName || !settings.agentsDir) return;
    await createAgent(settings.agentsDir, newName);
    setAgents(await loadAgents(settings.agentsDir));
    setNewName("");
  };

  const removeAgent = async (agent: Agent) => {
    await deleteAgent(agent.path);
    if (selectedAgent?.id === agent.id) selectAgent(null);
    setAgents(await loadAgents(settings.agentsDir));
  };

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* ── Agent list sidebar ──────────────────────────────────────────── */}
      <div style={{
        width: listCollapsed ? 32 : 220,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.18s ease",
      }}>
        {listCollapsed ? (
          /* Collapsed strip — just the expand button */
          <button
            onClick={() => setListCollapsed(false)}
            title="Expand agent list"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "var(--text-sm)",
            }}
          >
            ›
          </button>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: "var(--space-4) var(--space-4) 0", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Agents {agents.length > 0 && `(${agents.length})`}
                </span>
                <div style={{ display: "flex", gap: "var(--space-1)" }}>
                  <button onClick={openFolder} title="Open agents folder" style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>⊕</button>
                  <button onClick={() => setListCollapsed(true)} title="Collapse" style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>‹</button>
                </div>
              </div>
              {settings.agentsDir && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint, var(--text-muted))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {settings.agentsDir.split(/[\\/]/).pop()}
                </div>
              )}
            </div>

            {/* Agent list */}
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
              ) : loadError ? (
                <p style={{ padding: "var(--space-4)", color: "var(--error)", fontSize: "var(--text-xs)", wordBreak: "break-all" }}>
                  Error: {loadError}
                </p>
              ) : agents.length === 0 ? (
                <p style={{ padding: "var(--space-4)", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>No agents found. Create one below.</p>
              ) : (
                agents.map((agent) => (
                  <AgentItem
                    key={agent.id}
                    agent={agent}
                    selected={selectedAgent?.id === agent.id}
                    onSelect={selectAgent}
                    onDelete={removeAgent}
                  />
                ))
              )}
            </div>

            {/* New agent input */}
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
          </>
        )}
      </div>

      {/* ── Editor / empty state ─────────────────────────────────────────── */}
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

// ── AgentItem ────────────────────────────────────────────────────────────────

function AgentItem({
  agent, selected, onSelect, onDelete,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: (a: Agent) => void;
  onDelete: (a: Agent) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{ display: "flex", alignItems: "stretch", borderRadius: "var(--radius-md)", background: selected ? "var(--surface-3)" : "transparent" }}>
      <button
        onClick={() => { if (!confirmDelete) onSelect(agent); }}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          padding: "var(--space-3)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          color: "var(--text)",
          transition: "var(--transition)",
        }}
      >
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

      {/* Delete controls */}
      {confirmDelete ? (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, paddingRight: "var(--space-2)" }}>
          <button
            onClick={() => onDelete(agent)}
            title="Confirm delete"
            style={{ fontSize: "0.6rem", color: "var(--error)", fontWeight: 700, lineHeight: 1.2 }}
          >
            ✓
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            title="Cancel"
            style={{ fontSize: "0.6rem", color: "var(--text-muted)", lineHeight: 1.2 }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          title="Delete agent"
          style={{
            padding: "0 var(--space-2)",
            color: "var(--text-faint, var(--text-muted))",
            fontSize: "var(--text-xs)",
            opacity: 0.4,
            transition: "opacity var(--transition)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
        >
          🗑
        </button>
      )}
    </div>
  );
}
