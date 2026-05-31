import { create } from "zustand";
import { loadSettings, saveSettings } from "@/lib/settings";
import type { Agent, WorkflowRun, WorkflowStep } from "@/types";

export type Panel = "models" | "agents" | "chat" | "graph";

export interface Settings {
  defaultModel: string;
  agentsDir: string;
  ollamaBaseUrl: string;
  theme: "dark" | "light" | "system";
  /** Embedding model for semantic routing (default: nomic-embed-text). */
  embedModel: string;
  /** Routing mode exposed in Settings panel. */
  routingMode: "full" | "no-semantic" | "rules-only";
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
  addRunStep: (step: WorkflowStep) => void;
  streamBuffer: Record<string, string>;
  appendStream: (agentId: string, chunk: string) => void;
  clearStream: () => void;

  // Settings (persisted)
  settings: Settings;
  settingsLoaded: boolean;
  loadPersistedSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

const SETTINGS_DEFAULTS: Settings = {
  defaultModel: "",
  agentsDir: "",
  ollamaBaseUrl: "http://localhost:11434",
  theme: "dark",
  embedModel: "nomic-embed-text",
  routingMode: "full",
};

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

  settings: SETTINGS_DEFAULTS,
  settingsLoaded: false,

  loadPersistedSettings: async () => {
    const persisted = await loadSettings();
    const merged: Settings = { ...SETTINGS_DEFAULTS, ...persisted };
    set({ settings: merged, settingsLoaded: true });
    applyTheme(merged.theme);
  },

  updateSettings: async (patch) => {
    const next: Settings = { ...get().settings, ...patch };
    set({ settings: next });
    await saveSettings(patch);
    if (patch.theme) applyTheme(patch.theme);
  },
}));

// ── Theme application ────────────────────────────────────────────────────────

function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    root.setAttribute("data-theme", theme);
  }
}
