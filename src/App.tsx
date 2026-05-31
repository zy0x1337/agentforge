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
    setAgents,
  } = useAppStore();

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

  useEffect(() => {
    if (!settings.agentsDir) return;
    loadAgents(settings.agentsDir).then(setAgents).catch(console.error);
  }, [settings.agentsDir, setAgents]);

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
