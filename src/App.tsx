import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { isOllamaRunning, listLocalModels } from "@/lib/ollama";
import { loadAgents } from "@/lib/agentFs";
import { Sidebar } from "@/components/shared/Sidebar";
import ModelManager from "@/components/ModelManager/ModelManager";
import AgentExplorer from "@/components/AgentExplorer/AgentExplorer";
import ChatPanel from "@/components/ChatPanel/ChatPanel";
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

  // Load persisted settings once on mount
  useEffect(() => {
    loadPersistedSettings();
  }, [loadPersistedSettings]);

  // Poll Ollama health every 8s
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

  // Reload agents whenever agentsDir changes
  useEffect(() => {
    if (!settings.agentsDir) return;
    loadAgents(settings.agentsDir).then(setAgents).catch(console.error);
  }, [settings.agentsDir, setAgents]);

  // Blank screen while settings are being read from disk
  if (!settingsLoaded) {
    return (
      <div style={{
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--text-muted)",
        fontSize: "var(--text-xs)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.05em",
      }}>
        loading…
      </div>
    );
  }

  // Graph panel is available offline (static agent preview needs no Ollama)
  const showGraph = activePanel === "graph";

  return (
    <div style={{ display: "flex", height: "100dvh", background: "var(--bg)" }}>
      <Sidebar />
      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Graph panel bypasses OllamaGate — works without Ollama running */}
        {showGraph ? (
          <WorkflowGraph />
        ) : !ollamaRunning ? (
          <OllamaGate />
        ) : (
          <>
            {activePanel === "models" && <ModelManager />}
            {activePanel === "agents" && <AgentExplorer />}
            {activePanel === "chat"   && <ChatPanel />}
          </>
        )}
      </main>
    </div>
  );
}
