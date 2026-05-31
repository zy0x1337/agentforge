import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/useAppStore";
import { loadAgents, createAgent } from "@/lib/agentFs";
import type { Agent } from "@/types";

export default function AgentExplorer() {
  const { agents, setAgents, selectedAgent, selectAgent, settings, updateSettings } =
    useAppStore();
  const [newName, setNewName] = useState("");

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
      <div style={{ width: 240, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Agents {agents.length > 0 && `(${agents.length})`}
            </span>
            <button onClick={openFolder} title="Open folder" style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>⊕</button>
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
              <button onClick={openFolder} style={{ padding: "var(--space-2) var(--space-4)", background: "var(--primary)", color: "#fff", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)" }}>Open Agents Folder</button>
            </div>
          ) : agents.length === 0 ? (
            <p style={{ padding: "var(--space-4)", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>No agents found. Create one below.</p>
          ) : (
            agents.map((agent) => <AgentItem key={agent.id} agent={agent} selected={selectedAgent?.id === agent.id} onSelect={selectAgent} />)
          )}
        </div>

        {settings.agentsDir && (
          <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border)", display: "flex", gap: "var(--space-2)" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAgent()}
              placeholder="New agent name"
              style={{ flex: 1, padding: "var(--space-2)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", color: "var(--text)" }}
            />
            <button onClick={addAgent} style={{ padding: "var(--space-2) var(--space-3)", background: "var(--primary)", color: "#fff", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)" }}>+</button>
          </div>
        )}
      </div>

      {/* Agent detail */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
        {!selectedAgent ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--space-3)", color: "var(--text-muted)" }}>
            <span style={{ fontSize: "2rem" }}>◈</span>
            <p style={{ fontSize: "var(--text-sm)" }}>Select an agent to view details</p>
          </div>
        ) : (
          <AgentDetail agent={selectedAgent} />
        )}
      </div>
    </div>
  );
}

function AgentItem({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: (a: Agent) => void }) {
  return (
    <button onClick={() => onSelect(agent)} style={{ width: "100%", textAlign: "left", padding: "var(--space-3)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: 2, background: selected ? "var(--surface-3)" : "transparent", color: "var(--text)", transition: "var(--transition)" }}>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{agent.frontmatter.name}</span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.frontmatter.description || agent.id}</span>
      {agent.frontmatter.model && <span style={{ fontSize: "0.65rem", color: "var(--primary)", fontFamily: "var(--font-mono)" }}>{agent.frontmatter.model}</span>}
    </button>
  );
}

function AgentDetail({ agent }: { agent: Agent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 720 }}>
      <div>
        <h1 style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-1)" }}>{agent.frontmatter.name}</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{agent.frontmatter.description}</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {agent.frontmatter.model && <Pill label="model" value={agent.frontmatter.model} color="var(--primary)" />}
        {agent.frontmatter.context_mode && <Pill label="context" value={agent.frontmatter.context_mode} color="var(--accent)" />}
        {agent.frontmatter.next_agents?.map((na) => <Pill key={na} label="→" value={na} color="var(--success)" />)}
        {agent.frontmatter.triggers?.map((t) => <Pill key={t} label="trigger" value={t} color="var(--warning)" />)}
      </div>
      <MdSection title="persona.md" content={agent.persona} />
      {agent.prompt && <MdSection title="prompt.md" content={agent.prompt} />}
      {agent.workflow && <MdSection title="workflow.md" content={agent.workflow} />}
    </div>
  );
}

function MdSection({ title, content }: { title: string; content: string }) {
  return (
    <section>
      <h2 style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "var(--space-3)" }}>{title}</h2>
      <pre style={{ background: "var(--surface-2)", padding: "var(--space-4)", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid var(--border)" }}>{content}</pre>
    </section>
  );
}

function Pill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", gap: "var(--space-1)", alignItems: "center", padding: "2px var(--space-3)", borderRadius: "var(--radius-full)", background: "var(--surface-3)", fontSize: "var(--text-xs)" }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </span>
  );
}
