import { useState, useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import { pullModel, deleteModel, listLocalModels } from "@/lib/ollama";

const POPULAR = [
  { name: "llama3.2:3b",       label: "Llama 3.2 3B",      size: "~2 GB",   tags: ["fast", "general"] },
  { name: "llama3.1:8b",       label: "Llama 3.1 8B",      size: "~4.7 GB", tags: ["general"] },
  { name: "qwen2.5-coder:7b",  label: "Qwen 2.5 Coder 7B", size: "~4.4 GB", tags: ["code"] },
  { name: "mistral:7b",        label: "Mistral 7B",        size: "~4.1 GB", tags: ["general"] },
  { name: "deepseek-r1:8b",    label: "DeepSeek R1 8B",    size: "~4.9 GB", tags: ["reasoning"] },
  { name: "phi4:14b",          label: "Phi-4 14B",         size: "~8.5 GB", tags: ["general", "smart"] },
  { name: "gemma3:4b",         label: "Gemma 3 4B",        size: "~2.5 GB", tags: ["fast"] },
  { name: "nomic-embed-text",  label: "Nomic Embed",       size: "~274 MB", tags: ["embedding"] },
];

const HEADING = {
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: "var(--space-3)",
};

export default function ModelManager() {
  const {
    localModels,
    setLocalModels,
    pullingModel,
    pullProgress,
    setPullProgress,
    settings,
    updateSettings,
    agents,
  } = useAppStore();
  const [customModel, setCustomModel] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const pull = async (name: string) => {
    setPullProgress(name, 0);
    try {
      await pullModel(name, (_status, pct) => setPullProgress(name, pct ?? 0));
    } finally {
      setPullProgress(null);
      const fresh = await listLocalModels(settings.ollamaBaseUrl).catch(() => []);
      setLocalModels(fresh);
    }
  };

  const remove = async (name: string) => {
    await deleteModel(name, settings.ollamaBaseUrl);
    setLocalModels(localModels.filter((m) => m.name !== name));
    setConfirmDelete(null);
  };

  const installed = new Set(localModels.map((m) => m.name));

  // Build the "required by agents" list: agent models + embed model
  const requiredModels = useMemo(() => {
    const map = new Map<string, string[]>(); // modelName → usedBy labels

    for (const agent of agents) {
      const model = agent.frontmatter.model?.trim();
      if (model) {
        if (!map.has(model)) map.set(model, []);
        map.get(model)!.push(agent.frontmatter.name || agent.id);
      }
    }

    const embedModel = (settings.embedModel || "nomic-embed-text").trim();
    if (!map.has(embedModel)) map.set(embedModel, []);
    map.get(embedModel)!.push("semantic routing");

    return Array.from(map.entries()).map(([name, usedBy]) => ({
      name,
      usedBy,
      installed: localModels.some((m) => m.name === name),
    }));
  }, [agents, settings.embedModel, localModels]);

  const missingCount = requiredModels.filter((r) => !r.installed).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "var(--space-6)", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ fontSize: "var(--text-lg)", color: "var(--text)", marginBottom: "var(--space-1)" }}>Models</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
          {localModels.length} installed
          {missingCount > 0 && (
            <span style={{ color: "var(--error)", marginLeft: "var(--space-3)" }}>
              · {missingCount} required model{missingCount !== 1 ? "s" : ""} missing
            </span>
          )}
        </p>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>

        {/* ── Required by agents ──────────────────────────────────────────── */}
        {agents.length > 0 && (
          <section>
            <h2 style={HEADING}>Required by agents</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {requiredModels.map(({ name, usedBy, installed: isInstalled }) => {
                const isPulling = pullingModel === name;
                return (
                  <div key={name} style={{
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--surface-2)",
                    borderRadius: "var(--radius-md)",
                    border: isInstalled
                      ? "1px solid transparent"
                      : "1px solid color-mix(in oklab, var(--error) 40%, transparent)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                          {name}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", marginLeft: "var(--space-2)" }}>
                          {usedBy.join(", ")}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
                        {isInstalled ? (
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--success, #4ade80)" }}>✓</span>
                        ) : (
                          <>
                            <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>missing</span>
                            <button
                              onClick={() => !pullingModel && pull(name)}
                              disabled={!!pullingModel}
                              style={{
                                fontSize: "var(--text-xs)",
                                padding: "2px var(--space-3)",
                                borderRadius: "var(--radius-full)",
                                background: "var(--primary)",
                                color: "#fff",
                                opacity: pullingModel && !isPulling ? 0.4 : 1,
                              }}
                            >
                              {isPulling ? `${pullProgress}%` : "Pull"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isPulling && (
                      <div style={{ height: 2, background: "var(--surface-3)", borderRadius: 1, overflow: "hidden", marginTop: "var(--space-2)" }}>
                        <div style={{ height: "100%", width: `${pullProgress}%`, background: "var(--primary)", transition: "width 0.3s" }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Installed models ────────────────────────────────────────────── */}
        {localModels.length > 0 && (
          <section>
            <h2 style={HEADING}>Installed</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {localModels.map((m) => (
                <div key={m.name} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--surface-2)",
                  borderRadius: "var(--radius-md)",
                  border: settings.defaultModel === m.name ? "1px solid var(--primary-dim)" : "1px solid transparent",
                }}>
                  <div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{m.name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", marginLeft: "var(--space-2)" }}>
                      {(m.size / 1e9).toFixed(1)} GB
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button
                      onClick={() => updateSettings({ defaultModel: m.name })}
                      style={{
                        fontSize: "var(--text-xs)", padding: "2px var(--space-3)",
                        borderRadius: "var(--radius-full)",
                        background: settings.defaultModel === m.name ? "var(--primary)" : "var(--surface-3)",
                        color: settings.defaultModel === m.name ? "#fff" : "var(--text-muted)",
                      }}
                    >
                      {settings.defaultModel === m.name ? "Default ✓" : "Set default"}
                    </button>
                    {confirmDelete === m.name ? (
                      <>
                        <button
                          onClick={() => remove(m.name)}
                          style={{ fontSize: "var(--text-xs)", color: "var(--error)", padding: "2px var(--space-2)", fontWeight: 600 }}
                        >
                          Delete?
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "2px var(--space-2)" }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(m.name)}
                        style={{ fontSize: "var(--text-xs)", color: "var(--error)", padding: "2px var(--space-2)" }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Popular models grid ──────────────────────────────────────────── */}
        <section>
          <h2 style={HEADING}>Popular Models</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-3)" }}>
            {POPULAR.map((m) => {
              const isPulling = pullingModel === m.name;
              const isInstalled = installed.has(m.name);
              return (
                <div key={m.name} style={{
                  padding: "var(--space-4)", background: "var(--surface-2)",
                  borderRadius: "var(--radius-lg)", border: "1px solid var(--border)",
                  display: "flex", flexDirection: "column", gap: "var(--space-2)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text)" }}>{m.name}</span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{m.size}</span>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
                    {m.tags.map((t) => (
                      <span key={t} style={{ fontSize: "0.65rem", padding: "1px 6px", background: "var(--surface-3)", borderRadius: "var(--radius-full)", color: "var(--text-muted)" }}>{t}</span>
                    ))}
                  </div>
                  {isPulling && (
                    <div style={{ height: 3, background: "var(--surface-3)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pullProgress}%`, background: "var(--primary)", transition: "width 0.3s" }} />
                    </div>
                  )}
                  <button
                    onClick={() => !isInstalled && !pullingModel && pull(m.name)}
                    disabled={isInstalled || !!pullingModel}
                    style={{
                      padding: "var(--space-2)", borderRadius: "var(--radius-md)",
                      fontSize: "var(--text-xs)", marginTop: "auto",
                      background: isInstalled ? "var(--surface-3)" : "var(--primary)",
                      color: isInstalled ? "var(--text-muted)" : "#fff",
                      opacity: pullingModel && !isPulling ? 0.4 : 1,
                    }}
                  >
                    {isInstalled ? "Installed ✓" : isPulling ? `Downloading ${pullProgress}%` : "Download"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Custom pull ──────────────────────────────────────────────────── */}
        <section>
          <h2 style={HEADING}>Custom Model</h2>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="e.g. qwen2.5:32b"
              style={{
                flex: 1, padding: "var(--space-2) var(--space-4)",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", color: "var(--text)",
                fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              }}
            />
            <button
              onClick={() => { if (customModel) { pull(customModel); setCustomModel(""); } }}
              style={{ padding: "var(--space-2) var(--space-6)", background: "var(--primary)", color: "#fff", borderRadius: "var(--radius-md)", fontSize: "var(--text-sm)" }}
            >
              Pull
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
