import { load } from "@tauri-apps/plugin-store";

export interface AppSettings {
  defaultModel: string;
  agentsDir: string;
  ollamaBaseUrl: string;
}

const DEFAULTS: AppSettings = {
  defaultModel: "",
  agentsDir: "",
  ollamaBaseUrl: "http://localhost:11434",
};

const STORE_FILE = "settings.json";

let _store: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!_store) {
    _store = await load(STORE_FILE, { autoSave: true });
  }
  return _store;
}

export async function loadSettings(): Promise<AppSettings> {
  const store = await getStore();
  const settings: Partial<AppSettings> = {};

  for (const key of Object.keys(DEFAULTS) as (keyof AppSettings)[]) {
    const val = await store.get<string>(key);
    settings[key] = val ?? DEFAULTS[key];
  }

  return settings as AppSettings;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const store = await getStore();
  for (const [key, value] of Object.entries(patch)) {
    await store.set(key, value);
  }
}

export async function resetSettings(): Promise<void> {
  const store = await getStore();
  await store.reset();
}
