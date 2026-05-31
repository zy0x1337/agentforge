/**
 * ggufDownloader.ts
 *
 * TypeScript bridge for direct GGUF downloads (Tauri `download_gguf` command)
 * and Ollama local import (Tauri `import_gguf_to_ollama` command).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

// ─── Types ────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  downloadId: string;
  bytesReceived: number;
  totalBytes: number; // 0 = unknown
  done: boolean;
  error?: string;
}

export interface OllamaImportStatus {
  importId: string;
  status: string;
  done: boolean;
  error?: string;
}

export interface DownloadOptions {
  downloadId: string;
  url: string;
  filename: string;
  onProgress: (p: DownloadProgress) => void;
  onDone: (destPath: string, error?: string) => void;
}

export interface ImportOptions {
  importId: string;
  ggufPath: string;
  modelName: string;
  onStatus: (line: string) => void;
  onDone: (error?: string) => void;
}

// ─── Folder picker ────────────────────────────────────────────────────────

/**
 * Open a native folder-picker dialog and return the chosen path.
 * Returns null if the user cancels.
 */
export async function pickModelsFolder(): Promise<string | null> {
  const result = await openDialog({
    directory: true,
    multiple: false,
    title: 'Select models folder',
  });
  if (!result) return null;
  return Array.isArray(result) ? result[0] : result;
}

// ─── Direct download ─────────────────────────────────────────────────────

/**
 * Download a GGUF file to `folder/filename` via the Rust `download_gguf` command.
 * Streams progress events and calls onDone when finished.
 * Returns a cleanup function to unlisten from events.
 */
export async function downloadGguf(folder: string, opts: DownloadOptions): Promise<() => void> {
  const destPath = `${folder}\\${opts.filename}`.replace(/\/+/g, '\\');
  const unlisteners: UnlistenFn[] = [];

  const unProg = await listen<{
    download_id: string;
    bytes_received: number;
    total_bytes: number;
    done: boolean;
    error?: string;
  }>('download://progress', ({ payload: p }) => {
    if (p.download_id !== opts.downloadId) return;
    const progress: DownloadProgress = {
      downloadId: p.download_id,
      bytesReceived: p.bytes_received,
      totalBytes: p.total_bytes,
      done: p.done,
      error: p.error,
    };
    opts.onProgress(progress);
    if (p.done || p.error) {
      opts.onDone(destPath, p.error);
      cleanup();
    }
  });

  unlisteners.push(unProg);
  const cleanup = () => unlisteners.forEach((fn) => fn());

  try {
    await invoke('download_gguf', {
      downloadId: opts.downloadId,
      url: opts.url,
      destPath,
    });
  } catch (err) {
    opts.onDone(destPath, String(err));
    cleanup();
  }

  return cleanup;
}

// ─── Ollama import ────────────────────────────────────────────────────────

/**
 * Import a locally downloaded GGUF into Ollama via `ollama create`.
 * Streams status lines and calls onDone on completion.
 */
export async function importGgufToOllama(opts: ImportOptions): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];

  const unImport = await listen<{
    import_id: string;
    status: string;
    done: boolean;
    error?: string;
  }>('ollama://import', ({ payload: p }) => {
    if (p.import_id !== opts.importId) return;
    opts.onStatus(p.status);
    if (p.done) {
      opts.onDone(p.error);
      cleanup();
    }
  });

  unlisteners.push(unImport);
  const cleanup = () => unlisteners.forEach((fn) => fn());

  try {
    await invoke('import_gguf_to_ollama', {
      importId: opts.importId,
      modelName: opts.modelName,
      ggufPath: opts.ggufPath,
    });
  } catch (err) {
    opts.onDone(String(err));
    cleanup();
  }

  return cleanup;
}

// ─── Model name helper ────────────────────────────────────────────────────

/**
 * Derive a sensible Ollama model name from a GGUF filename.
 * e.g. "Qwen2.5-7B-Instruct-Q4_K_M.gguf" → "qwen2.5-7b-instruct-q4_k_m"
 */
export function deriveModelName(filename: string): string {
  return filename
    .replace(/\.gguf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
