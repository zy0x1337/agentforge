import { useAppStore } from "@/store/useAppStore";

const NAV = [
  { id: "models" as const, icon: "⬡", label: "Models" },
  { id: "agents" as const, icon: "◈", label: "Agents" },
  { id: "chat"   as const, icon: "▶", label: "Run"    },
] as const;

export default function Sidebar() {
  const { activePanel, setActivePanel, ollamaRunning } = useAppStore();

  return (
    <nav
      style={{
        width: 56,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "var(--space-4) 0",
        gap: "var(--space-2)",
        flexShrink: 0,
      }}
    >
      <div style={{ marginBottom: "var(--space-4)", color: "var(--primary)", fontSize: "1.25rem" }}>
        ⬡
      </div>

      {NAV.map((item) => (
        <button
          key={item.id}
          onClick={() => setActivePanel(item.id)}
          title={item.label}
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-md)",
            fontSize: "1rem",
            color: activePanel === item.id ? "var(--primary)" : "var(--text-muted)",
            background: activePanel === item.id ? "var(--surface-2)" : "transparent",
            transition: "var(--transition)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {item.icon}
        </button>
      ))}

      <div style={{ marginTop: "auto", marginBottom: "var(--space-2)" }}>
        <div
          title={ollamaRunning ? "Ollama running" : "Ollama offline"}
          style={{
            width: 8,
            height: 8,
            borderRadius: "var(--radius-full)",
            background: ollamaRunning ? "var(--success)" : "var(--error)",
          }}
        />
      </div>
    </nav>
  );
}
