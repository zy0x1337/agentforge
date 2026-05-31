import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { isOllamaRunning, listLocalModels } from "@/lib/ollama";
import { loadAgents } from "@/lib/agentFs";
import { Sidebar } from "@/components/shared/Sidebar";
import ModelManager from "@/components/ModelManager/ModelManager";
import AgentExplorer from "@/components/AgentExplorer/AgentExplorer";
import ChatPanel from "@/components/ChatPanel/ChatPanel";
import HistorySidebar from "@/components/HistorySidebar/HistorySidebar";
import OllamaGate from "@/components/shared/OllamaGate";
import { WorkflowGraph } from "@/components/WorkflowGraph/WorkflowGraph";

export default function App() {
  const {
    activePanel,
    ollamaRunning,
    setOllamaRunning,
    setLocalModels,
    settings,
    settingsLoaded,
    loadPersistedSettings,
    setAgents,
  } = useAppStore();

  const { hydrateHistory } = useHistoryStore();

  // ── 1. Load persisted settings (must be first) ─────────────────────────────
  useEffect(() => {
    loadPersistedSettings();
  }, [loadPersistedSettings]);

  // ── 2. Hydrate run history from disk (after settings are ready) ────────────
  //    tauri-plugin-store is available as soon as the webview mounts, but we
  //    wait for settingsLoaded so both stores initialise in a predictable order.
  useEffect(() => {
    if (!settingsLoaded) return;
    hydrateHistory();
  }, [settingsLoaded, hydrateHistory]);

  // ── 3. Poll Ollama health every 8 s ───────────────────────────────────────
  useEffect(() => {
    if (!settingsLoaded) return;

    const check = async () => {
      const running = await isOllamaRunning(settings.ollamaBaseUrl);
      setOllamaRunning(running);
      if (running) {
        const models = await listLocalModels(settings.ollamaBaseUrl).catch(() => []);
        setLocalModels(models);
      }
    };

    check();
    const interval = setInterval(check, 8000);
    return () => clearInterval(interval);
  }, [settingsLoaded, settings.ollamaBaseUrl, setOllamaRunning, setLocalModels]);

  // ── 4. Reload agents whenever agentsDir changes ───────────────────────────
  useEffect(() => {
    if (!settings.agentsDir) return;
    loadAgents(settings.agentsDir).then(setAgents).catch(console.error);
  }, [settings.agentsDir, setAgents]);

  // ── Loading splash ────────────────────────────────────────────────────────
  if (!settingsLoaded) {
    return (
      <div style={{
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
        color: "var(--color-text-muted)",
        fontSize: "var(--text-xs)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.05em",
      }}>
        loading…
      </div>
    );
  }

  const showGraph = activePanel === "graph";
  const showChat  = activePanel === "chat";

  return (
    <div style={{ display: "flex", height: "100dvh", background: "var(--color-bg)" }}>
      <Sidebar />

      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Graph panel — works without Ollama (static preview) ────────── */}
        {showGraph ? (
          <>
            <HistorySidebar />
            <WorkflowGraph />
          </>
        ) : !ollamaRunning ? (

          /* ── Ollama not running ─────────────────────────────────────────── */
          <OllamaGate />

        ) : (

          /* ── Normal panels ──────────────────────────────────────────────── */
          <>
            {activePanel === "models" && <ModelManager />}
            {activePanel === "agents" && <AgentExplorer />}
            {showChat && (
              <>
                <HistorySidebar />
                <ChatPanel />
              </>
            )}
          </>

        )}
      </main>
    </div>
  );
}
