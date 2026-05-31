import { create } from "zustand";
import { loadSettings, saveSettings } from "@/lib/settings";
import type { Agent, WorkflowRun, RunStep } from "@/types";

export type Panel = "models" | "agents" | "chat";

interface Settings {
  defaultModel: string;
  agentsDir: string;
  ollamaBaseUrl: string;
}

interface AppState {
  // UI
  activePanel: Panel;
  setActivePanel: (p: Panel) => void;

  // Ollama
  ollamaRunning: boolean;
  setOllamaRunning: (v: boolean) => void;

  // Models
  localModels: { name: string; size: number; modified: string }[];
  setLocalModels: (m: AppState["localModels"]) => void;
  pullingModel: string | null;
  pullProgress: number;
  setPullProgress: (name: string | null, pct?: number) => void;

  // Agents
  agents: Agent[];
  setAgents: (a: Agent[]) => void;
  selectedAgent: Agent | null;
  selectAgent: (a: Agent | null) => void;

  // Run
  activeRun: WorkflowRun | null;
  setActiveRun: (r: WorkflowRun) => void;
  addRunStep: (step: RunStep) => void;
  streamBuffer: Record<string, string>;
  appendStream: (agentId: string, chunk: string) => void;
  clearStream: () => void;

  // Settings (persisted)
  settings: Settings;
  settingsLoaded: boolean;
  loadPersistedSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  activePanel: "models",
  setActivePanel: (p) => set({ activePanel: p }),

  ollamaRunning: false,
  setOllamaRunning: (v) => set({ ollamaRunning: v }),

  localModels: [],
  setLocalModels: (m) => set({ localModels: m }),
  pullingModel: null,
  pullProgress: 0,
  setPullProgress: (name, pct = 0) =>
    set({ pullingModel: name, pullProgress: pct }),

  agents: [],
  setAgents: (a) => set({ agents: a }),
  selectedAgent: null,
  selectAgent: (a) => set({ selectedAgent: a }),

  activeRun: null,
  setActiveRun: (r) => set({ activeRun: r }),
  addRunStep: (step) =>
    set((s) => ({
      activeRun: s.activeRun
        ? { ...s.activeRun, steps: [...s.activeRun.steps, step] }
        : null,
    })),
  streamBuffer: {},
  appendStream: (agentId, chunk) =>
    set((s) => ({
      streamBuffer: {
        ...s.streamBuffer,
        [agentId]: (s.streamBuffer[agentId] ?? "") + chunk,
      },
    })),
  clearStream: () => set({ streamBuffer: {} }),

  settings: {
    defaultModel: "",
    agentsDir: "",
    ollamaBaseUrl: "http://localhost:11434",
  },
  settingsLoaded: false,

  loadPersistedSettings: async () => {
    const { loadSettings } = await import("@/lib/settings");
    const persisted = await loadSettings();
    set({ settings: persisted, settingsLoaded: true });
  },

  updateSettings: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await saveSettings(patch);
  },
}));
