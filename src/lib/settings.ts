/**
 * settings.ts
 * Thin wrapper around tauri-plugin-store for typed settings persistence.
 * All reads/writes go through this module — the Zustand store calls these.
 */
import { load } from "@tauri-apps/plugin-store";
import type { AppSettings } from "@/types";

const STORE_FILE = "settings.json";

const DEFAULTS: AppSettings = {
  agentsDir: "",
  defaultModel: "",
  ollamaBaseUrl: "http://localhost:11434",
  theme: "system",
};

async function getStore() {
  return load(STORE_FILE, { autoSave: true });
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const store = await getStore();
    const saved = await store.get<Partial<AppSettings>>("settings");
    return { ...DEFAULTS, ...(saved ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    const store = await getStore();
    await store.set("settings", settings);
  } catch (e) {
    console.warn("[settings] Failed to persist settings:", e);
  }
}
