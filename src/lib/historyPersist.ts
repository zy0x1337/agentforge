/**
 * historyPersist
 *
 * Thin wrapper around tauri-plugin-store for WorkflowRun history.
 *
 * Storage key : "agentforge_run_history"
 * Store file  : %APPDATA%\AgentForge\history.json  (managed by the plugin)
 *
 * Only serialisable fields are stored — AbortController references are
 * stripped automatically because WorkflowRun contains none.
 */
import { Store } from "@tauri-apps/plugin-store";
import type { WorkflowRun } from "@/types";

const STORE_FILE = "history.json";
const STORE_KEY  = "agentforge_run_history";

/** Lazy singleton — one Store instance per process. */
let _store: Store | null = null;
async function getStore(): Promise<Store> {
  if (!_store) _store = await Store.load(STORE_FILE);
  return _store;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load persisted runs from disk.
 * Returns an empty array when the key doesn't exist yet.
 */
export async function loadHistory(): Promise<WorkflowRun[]> {
  const store = await getStore();
  const raw = await store.get<WorkflowRun[]>(STORE_KEY);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Persist the given runs array to disk.
 * Replaces the entire list — callers own slicing to MAX_HISTORY.
 */
export async function saveHistory(runs: WorkflowRun[]): Promise<void> {
  const store = await getStore();
  await store.set(STORE_KEY, runs);
  await store.save();
}

/**
 * Remove all persisted history from disk.
 */
export async function clearPersistedHistory(): Promise<void> {
  const store = await getStore();
  await store.delete(STORE_KEY);
  await store.save();
}
