/**
 * modelDownloader.ts
 * Handles downloading GGUF files from Hugging Face to a
 * user-selected local folder via the Tauri FS + HTTP APIs,
 * with progress streaming and cancellation support.
 *
 * Also exposes `importIntoOllama` for one-click Ollama import
 * of a GGUF file that is already on disk.
 */

import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { BaseDirectory, exists } from '@tauri-apps/plugin-fs';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HfFileEntry {
  /** Full Hugging Face repo id, e.g. "bartowski/Llama-3.1-8B-Instruct-GGUF" */
  repoId: string;
  /** Filename inside the repo, e.g. "Llama-3.1-8B-Instruct-Q4_K_M.gguf" */
  filename: string;
  /** File size in bytes (from HF API) */
  sizeBytes: number;
  /** SHA256 provided by HF (optional) */
  sha256?: string;
}

export interface DownloadProgress {
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
  /** 0–100 */
  percent: number;
  /** Bytes/second */
  speed: number;
  status: 'pending' | 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled';
  errorMessage?: string;
}

export interface DownloadHandle {
  /** Unique ID for this download job */
  id: string;
  /** Call to stop the download */
  cancel: () => void;
  /** Subscribe to progress events */
  onProgress: (cb: (p: DownloadProgress) => void) => UnlistenFn;
}

export interface OllamaImportResult {
  success: boolean;
  modelName: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Folder selection
// ---------------------------------------------------------------------------

/** Persists selected models folder in memory (no localStorage — sandbox). */
let _modelsFolder: string | null = null;

export function getModelsFolder(): string | null {
  return _modelsFolder;
}

/**
 * Opens a native folder-picker dialog and stores the result.
 * Returns the selected path or null if cancelled.
 */
export async function selectModelsFolder(): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: 'Select models folder',
  });
  if (typeof selected === 'string') {
    _modelsFolder = selected;
  }
  return _modelsFolder;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Downloads a GGUF file from Hugging Face to the user-selected models folder.
 *
 * Internally calls the Rust sidecar command `download_gguf` which streams
 * chunks and emits progress events on the `download://progress/{id}` channel.
 *
 * @param file   - HF file descriptor
 * @param folder - Destination folder (defaults to stored models folder)
 */
export async function downloadGguf(
  file: HfFileEntry,
  folder?: string,
): Promise<DownloadHandle> {
  const destFolder = folder ?? _modelsFolder;
  if (!destFolder) {
    throw new Error(
      'No models folder selected. Call selectModelsFolder() first.',
    );
  }

  const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Kick off the Rust download command (non-blocking)
  invoke('download_gguf', {
    id,
    repoId: file.repoId,
    filename: file.filename,
    destFolder,
    expectedSha256: file.sha256 ?? null,
  }).catch((err) => {
    // Surface errors via the progress event so callers have a single path
    emit(`download://progress/${id}`, {
      filename: file.filename,
      downloadedBytes: 0,
      totalBytes: file.sizeBytes,
      percent: 0,
      speed: 0,
      status: 'error',
      errorMessage: String(err),
    } satisfies DownloadProgress);
  });

  const cancel = () => invoke('cancel_download', { id }).catch(() => {});

  const onProgress = (cb: (p: DownloadProgress) => void): UnlistenFn => {
    let unlisten: UnlistenFn = () => {};
    listen<DownloadProgress>(`download://progress/${id}`, (event) => {
      cb(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten();
  };

  return { id, cancel, onProgress };
}

// ---------------------------------------------------------------------------
// Ollama one-click import
// ---------------------------------------------------------------------------

/**
 * Imports a locally stored GGUF file into Ollama using `ollama create`.
 *
 * Creates a minimal Modelfile (`FROM <absolute-path>`) and calls
 * `ollama create <modelName> -f <modelfile-path>` via the Rust sidecar.
 *
 * @param localPath  - Absolute path to the .gguf file on disk
 * @param modelName  - Desired Ollama model name, e.g. "llama3-q4km"
 */
export async function importIntoOllama(
  localPath: string,
  modelName?: string,
): Promise<OllamaImportResult> {
  // Derive a sanitised model name from the filename if not provided
  const derivedName =
    modelName ??
    localPath
      .split(/[\\/]/).pop()!
      .replace(/\.gguf$/i, '')
      .replace(/[^a-z0-9_.-]/gi, '-')
      .toLowerCase()
      .slice(0, 64);

  // Verify the file exists before calling into Rust
  const fileExists = await exists(localPath, { baseDir: BaseDirectory.Home }).catch(
    () => false,
  );
  if (!fileExists) {
    return {
      success: false,
      modelName: derivedName,
      errorMessage: `File not found: ${localPath}`,
    };
  }

  try {
    await invoke('ollama_import_gguf', {
      localPath,
      modelName: derivedName,
    });
    return { success: true, modelName: derivedName };
  } catch (err) {
    return {
      success: false,
      modelName: derivedName,
      errorMessage: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// HF API helpers
// ---------------------------------------------------------------------------

export interface HfModelFile {
  rfilename: string;
  size: number;
  lfs?: { sha256: string; size: number; pointer_size: number };
}

/** Fetch the GGUF file list for a HF repo via the public API */
export async function fetchHfRepoFiles(repoId: string): Promise<HfModelFile[]> {
  const url = `https://huggingface.co/api/models/${repoId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HF API error ${res.status}: ${url}`);
  const data = await res.json();
  const siblings: HfModelFile[] = data.siblings ?? [];
  return siblings.filter((f) => f.rfilename.endsWith('.gguf'));
}
