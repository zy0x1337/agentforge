import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { isOllamaRunning, listLocalModels } from "@/lib/ollama";
import { loadAgents } from "@/lib/agentFs";
import Sidebar from "@/components/shared/Sidebar";
import ModelManager from "@/components/ModelManager/ModelManager";
import AgentExplorer from "@/components/AgentExplorer/AgentExplorer";
import ChatPanel from "@/components/ChatPanel/ChatPanel";
import OllamaGate from "@/components/shared/OllamaGate";

export default function App() {
  const {
    activePanel,
    ollamaRunning,
    setOllamaRunning,
    setLocalModels,
    settings,
    settingsLoaded,
    setAgents,
    initSettings,
  } = useAppStore();

  // Load persisted settings once on mount
  useEffect(() => {
    initSettings();
  }, [initSettings]);

  // Poll Ollama health every 8s
  useEffect(() => {
    const check = async () => {
      const running = await isOllamaRunning();
      setOllamaRunning(running);
      if (running) {
        const models = await listLocalModels().catch(() => []);
        setLocalModels(models);
      }
    };
    check();
    const interval = setInterval(check, 8000);
    return () => clearInterval(interval);
  }, [setOllamaRunning, setLocalModels]);

  // Reload agents whenever agentsDir changes (after settings are loaded)
  useEffect(() => {
    if (!settingsLoaded || !settings.agentsDir) return;
    loadAgents(settings.agentsDir).then(setAgents).catch(console.error);
  }, [settings.agentsDir, settingsLoaded, setAgents]);

  // Don't render panels until settings are hydrated
  if (!settingsLoaded) {
    return (
      <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: "var(--bg)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100dvh", background: "var(--bg)" }}>
      <Sidebar />
      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {!ollamaRunning ? (
          <OllamaGate />
        ) : (
          <>
            {activePanel === "models" && <ModelManager />}
            {activePanel === "agents" && <AgentExplorer />}
            {activePanel === "chat" && <ChatPanel />}
          </>
        )}
      </main>
    </div>
  );
}
