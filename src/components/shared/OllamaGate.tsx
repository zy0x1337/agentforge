import { invoke } from "@tauri-apps/api/core";

export default function OllamaGate() {
  const install = () => invoke("install_ollama");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--space-8)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "2.5rem" }}>⬡</div>
      <h2 style={{ color: "var(--text)", fontSize: "var(--text-lg)" }}>Ollama not detected</h2>
      <p style={{ color: "var(--text-muted)", maxWidth: "38ch" }}>
        AgentForge requires Ollama to run local models. Install it automatically
        via winget, or download manually.
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <button
          onClick={install}
          style={{
            padding: "var(--space-2) var(--space-6)",
            background: "var(--primary)",
            color: "#fff",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--text-sm)",
          }}
        >
          Install via winget
        </button>
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "var(--space-2) var(--space-6)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
            textDecoration: "none",
          }}
        >
          Manual Download
        </a>
      </div>
    </div>
  );
}
