import { create } from "zustand";
import type { Agent, OllamaModel, WorkflowRun, WorkflowStep, AppSettings } from "@/types";
import { loadSettings, saveSettings } from "@/lib/settings";

interface AppState {
  settings: AppSettings;
  settingsLoaded: boolean;
  updateSettings: (s: Partial<AppSettings>) => void;
  initSettings: () => Promise<void>;

  ollamaRunning: boolean;
  setOllamaRunning: (v: boolean) => void;
  localModels: OllamaModel[];
  setLocalModels: (m: OllamaModel[]) => void;
  pullingModel: string | null;
  pullProgress: number;
  setPullProgress: (model: string | null, pct?: number) => void;

  agents: Agent[];
  setAgents: (a: Agent[]) => void;
  selectedAgent: Agent | null;
  selectAgent: (a: Agent | null) => void;

  activeRun: WorkflowRun | null;
  setActiveRun: (r: WorkflowRun | null) => void;
  addRunStep: (step: WorkflowStep) => void;
  streamBuffer: Record<string, string>;
  appendStream: (agentId: string, token: string) => void;
  clearStream: () => void;

  activePanel: "models" | "agents" | "chat";
  setActivePanel: (p: "models" | "agents" | "chat") => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  agentsDir: "",
  defaultModel: "",
  ollamaBaseUrl: "http://localhost:11434",
  theme: "system",
};

export const useAppStore = create<AppState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  settingsLoaded: false,

  initSettings: async () => {
    const settings = await loadSettings();
    set({ settings, settingsLoaded: true });
  },

  updateSettings: (partial) =>
    set((state) => {
      const next = { ...state.settings, ...partial };
      saveSettings(next);
      return { settings: next };
    }),

  ollamaRunning: false,
  setOllamaRunning: (v) => set({ ollamaRunning: v }),
  localModels: [],
  setLocalModels: (m) => set({ localModels: m }),
  pullingModel: null,
  pullProgress: 0,
  setPullProgress: (model, pct = 0) =>
    set({ pullingModel: model, pullProgress: pct }),

  agents: [],
  setAgents: (a) => set({ agents: a }),
  selectedAgent: null,
  selectAgent: (a) => set({ selectedAgent: a }),

  activeRun: null,
  setActiveRun: (r) => set({ activeRun: r }),
  addRunStep: (step) =>
    set((state) => {
      if (!state.activeRun) return {};
      const steps = [...state.activeRun.steps];
      const idx = steps.findIndex(
        (s) => s.agentId === step.agentId && s.status === "running"
      );
      if (idx >= 0) steps[idx] = step;
      else steps.push(step);
      return { activeRun: { ...state.activeRun, steps } };
    }),
  streamBuffer: {},
  appendStream: (agentId, token) =>
    set((state) => ({
      streamBuffer: {
        ...state.streamBuffer,
        [agentId]: (state.streamBuffer[agentId] ?? "") + token,
      },
    })),
  clearStream: () => set({ streamBuffer: {} }),

  activePanel: "agents",
  setActivePanel: (p) => set({ activePanel: p }),
}));
