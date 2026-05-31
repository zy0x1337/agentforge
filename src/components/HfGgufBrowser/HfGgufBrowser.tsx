/**
 * HfGgufBrowser v2
 *
 * Features:
 * - Provider filter bar (all, bartowski, TheBloke, lmstudio-community, unsloth, …)
 * - Quant tag badge per file with quality bar
 * - Sortable file table (name / size / quant)
 * - Direct download to a user-selected folder with progress bar
 * - One-click Ollama import for already-downloaded files
 */

import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  buildHfDownloadUrl,
  formatBytes,
  getGgufFiles,
  getRepoInfo,
  GgufFileInfo,
  HfRepoInfo,
  HfSearchItem,
  KNOWN_PROVIDERS,
  Provider,
  searchGgufRepos,
  SortKey,
  sortGgufFiles,
} from '../../lib/hfHub';
import {
  deriveModelName,
  downloadGguf,
  importGgufToOllama,
  pickModelsFolder,
} from '../../lib/ggufDownloader';
import styles from './HfGgufBrowser.module.css';

// ─── helpers ─────────────────────────────────────────────────────────────

function formatDate(v?: string) {
  if (!v) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(v));
  } catch { return v; }
}

const QUANT_COLOR: Record<string, string> = {
  IQ1_S: '#ef4444', IQ1_M: '#ef4444',
  IQ2_XXS: '#f97316', IQ2_XS: '#f97316', IQ2_S: '#f97316', IQ2_M: '#f97316',
  IQ3_XXS: '#eab308', IQ3_XS: '#eab308', IQ3_S: '#eab308', IQ3_M: '#eab308',
  Q2_K: '#eab308', Q2_K_S: '#eab308',
  IQ4_XS: '#84cc16', IQ4_NL: '#84cc16',
  Q3_K_S: '#84cc16', Q3_K_M: '#84cc16', Q3_K_L: '#84cc16',
  Q4_0: '#22c55e', Q4_1: '#22c55e', Q4_K_S: '#22c55e', Q4_K_M: '#22c55e',
  Q5_0: '#14b8a6', Q5_1: '#14b8a6', Q5_K_S: '#14b8a6', Q5_K_M: '#14b8a6',
  Q6_K: '#3b82f6',
  Q8_0: '#8b5cf6',
  F16: '#ec4899', BF16: '#ec4899', F32: '#ec4899',
};

// ─── per-file download state ──────────────────────────────────────────────

interface FileDownloadState {
  phase: 'idle' | 'downloading' | 'done' | 'importing' | 'imported' | 'error';
  progress: number; // 0–100
  destPath?: string;
  importLog: string[];
  error?: string;
}

const DEFAULT_FILE_STATE: FileDownloadState = {
  phase: 'idle', progress: 0, importLog: [],
};

// ─── component ───────────────────────────────────────────────────────────

export default function HfGgufBrowser() {
  const [query, setQuery] = useState('qwen gguf');
  const [provider, setProvider] = useState<Provider>('all');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<HfSearchItem[]>([]);

  const [selectedRepo, setSelectedRepo] = useState<HfRepoInfo | null>(null);
  const [repoBusy, setRepoBusy] = useState(false);
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortKey>('quant');
  const [modelsFolder, setModelsFolder] = useState<string | null>(null);

  // Per-file state: filename → FileDownloadState
  const [fileStates, setFileStates] = useState<Record<string, FileDownloadState>>({});

  const cleanupRefs = useRef<Record<string, () => void>>({});

  const ggufFiles = useMemo(
    () => selectedRepo ? sortGgufFiles(getGgufFiles(selectedRepo), sortBy) : [],
    [selectedRepo, sortBy],
  );

  function patchFile(filename: string, patch: Partial<FileDownloadState>) {
    setFileStates((prev) => ({
      ...prev,
      [filename]: { ...(prev[filename] ?? DEFAULT_FILE_STATE), ...patch },
    }));
  }

  // ── search ──────────────────────────────────────────────────────────────

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setSearchBusy(true);
    setSearchError(null);
    setSelectedRepo(null);
    setActiveRepoId(null);
    setFileStates({});
    try {
      const data = await searchGgufRepos({ query, provider, limit: 20 });
      setResults(data);
      if (data.length === 0) setSearchError('No GGUF repositories found.');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchBusy(false);
    }
  }

  // ── open repo ────────────────────────────────────────────────────────────

  async function handleOpenRepo(repoId: string) {
    setRepoBusy(true);
    setSearchError(null);
    setActiveRepoId(repoId);
    setSelectedRepo(null);
    setFileStates({});
    try {
      const repo = await getRepoInfo(repoId);
      setSelectedRepo(repo);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepoBusy(false);
    }
  }

  // ── folder picker ────────────────────────────────────────────────────────

  async function handlePickFolder() {
    const folder = await pickModelsFolder();
    if (folder) setModelsFolder(folder);
  }

  // ── download ─────────────────────────────────────────────────────────────

  const handleDownload = useCallback(async (file: GgufFileInfo) => {
    if (!selectedRepo) return;

    let folder = modelsFolder;
    if (!folder) {
      folder = await pickModelsFolder();
      if (!folder) return;
      setModelsFolder(folder);
    }

    const downloadId = `dl-${file.rfilename}-${Date.now()}`;
    patchFile(file.rfilename, { phase: 'downloading', progress: 0, importLog: [] });

    const cleanup = await downloadGguf(folder, {
      downloadId,
      url: buildHfDownloadUrl(selectedRepo.id, file.rfilename),
      filename: file.rfilename,
      onProgress: ({ bytesReceived, totalBytes }) => {
        const pct = totalBytes > 0 ? Math.round((bytesReceived / totalBytes) * 100) : -1;
        patchFile(file.rfilename, { progress: pct < 0 ? -1 : pct });
      },
      onDone: (destPath, error) => {
        if (error) {
          patchFile(file.rfilename, { phase: 'error', error });
        } else {
          patchFile(file.rfilename, { phase: 'done', progress: 100, destPath });
        }
      },
    });

    cleanupRefs.current[file.rfilename] = cleanup;
  }, [selectedRepo, modelsFolder]);

  // ── ollama import ─────────────────────────────────────────────────────────

  const handleOllamaImport = useCallback(async (file: GgufFileInfo) => {
    const state = fileStates[file.rfilename];
    if (!state?.destPath) return;

    const modelName = deriveModelName(file.rfilename);
    const importId = `import-${file.rfilename}-${Date.now()}`;
    patchFile(file.rfilename, { phase: 'importing', importLog: [] });

    await importGgufToOllama({
      importId,
      ggufPath: state.destPath,
      modelName,
      onStatus: (line) => {
        setFileStates((prev) => ({
          ...prev,
          [file.rfilename]: {
            ...(prev[file.rfilename] ?? DEFAULT_FILE_STATE),
            importLog: [...(prev[file.rfilename]?.importLog ?? []), line],
          },
        }));
      },
      onDone: (error) => {
        patchFile(file.rfilename, error ? { phase: 'error', error } : { phase: 'imported' });
      },
    });
  }, [fileStates]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Hugging Face GGUF Browser</h2>
          <p className={styles.subtitle}>
            Search public repositories, inspect GGUF artifacts, download directly, and import into Ollama.
          </p>
        </div>

        <div className={styles.folderPicker}>
          <span className={styles.folderLabel}>Models folder:</span>
          <button className={styles.folderBtn} onClick={handlePickFolder}>
            {modelsFolder ? modelsFolder : 'Select…'}
          </button>
        </div>
      </div>

      {/* Search bar + provider filter */}
      <div className={styles.controls}>
        <form className={styles.searchBar} onSubmit={handleSearch}>
          <input
            className={styles.input}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GGUF repos, e.g. llama 3 gguf"
            aria-label="Search Hugging Face GGUF repositories"
          />
          <button className={styles.searchBtn} type="submit" disabled={searchBusy}>
            {searchBusy ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className={styles.providerBar} role="group" aria-label="Provider filter">
          {KNOWN_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.providerChip} ${provider === p ? styles.providerChipActive : ''}`}
              onClick={() => setProvider(p)}
            >
              {p === 'all' ? 'All providers' : p}
            </button>
          ))}
        </div>
      </div>

      {searchError && <div className={styles.error}>{searchError}</div>}

      {/* Two-panel grid */}
      <div className={styles.grid}>

        {/* Left: repo list */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Repositories</h3>
            <span className={styles.meta}>{results.length} results</span>
          </div>
          <div className={styles.repoList}>
            {results.map((repo) => (
              <button
                key={repo.id}
                type="button"
                className={`${styles.repoCard} ${activeRepoId === repo.id ? styles.repoCardActive : ''}`}
                onClick={() => handleOpenRepo(repo.id)}
              >
                <div className={styles.repoTop}>
                  <span className={styles.repoId}>{repo.id}</span>
                  {repo.gated && <span className={styles.badge}>gated</span>}
                </div>
                <div className={styles.repoMeta}>
                  <span>↓ {(repo.downloads ?? 0).toLocaleString()}</span>
                  <span>♥ {repo.likes ?? 0}</span>
                  <span>{formatDate(repo.lastModified)}</span>
                </div>
              </button>
            ))}
            {results.length === 0 && !searchBusy && (
              <div className={styles.empty}>No repositories loaded yet.</div>
            )}
          </div>
        </section>

        {/* Right: file list */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>GGUF Files</h3>
            <div className={styles.sortBar}>
              {(['quant', 'size', 'name'] as SortKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.sortChip} ${sortBy === key ? styles.sortChipActive : ''}`}
                  onClick={() => setSortBy(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          {!selectedRepo && !repoBusy && (
            <div className={styles.empty}>Select a repository to inspect its GGUF files.</div>
          )}
          {repoBusy && <div className={styles.empty}>Loading…</div>}

          {selectedRepo && !repoBusy && (
            <div className={styles.fileList}>
              {ggufFiles.map((file) => (
                <FileRow
                  key={file.rfilename}
                  file={file}
                  state={fileStates[file.rfilename] ?? DEFAULT_FILE_STATE}
                  onDownload={() => handleDownload(file)}
                  onImport={() => handleOllamaImport(file)}
                />
              ))}
              {ggufFiles.length === 0 && (
                <div className={styles.empty}>No .gguf files found.</div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── FileRow sub-component ────────────────────────────────────────────────

interface FileRowProps {
  file: GgufFileInfo;
  state: FileDownloadState;
  onDownload: () => void;
  onImport: () => void;
}

function FileRow({ file, state, onDownload, onImport }: FileRowProps) {
  const color = QUANT_COLOR[file.quantTag] ?? '#94a3b8';
  const pct = state.progress;

  return (
    <div className={styles.fileRow}>
      <div className={styles.fileMain}>
        <div className={styles.fileNameRow}>
          <code className={styles.fileName}>{file.rfilename}</code>
          <span className={styles.quantBadge} style={{ color, borderColor: color }}>
            {file.quantTag}
          </span>
        </div>

        <div className={styles.fileMeta}>
          <span>{formatBytes(file.size)}</span>
          <div className={styles.qualityBar}>
            <div
              className={styles.qualityFill}
              style={{ width: `${Math.round(file.qualityRatio * 100)}%`, background: color }}
            />
          </div>
        </div>

        {/* Download progress */}
        {state.phase === 'downloading' && (
          <div className={styles.progressWrap}>
            <div
              className={styles.progressBar}
              style={{ width: pct >= 0 ? `${pct}%` : '100%' }}
              data-indeterminate={pct < 0}
            />
            <span className={styles.progressLabel}>
              {pct >= 0 ? `${pct}%` : 'downloading…'}
            </span>
          </div>
        )}

        {/* Ollama import log */}
        {(state.phase === 'importing' || state.importLog.length > 0) && (
          <pre className={styles.importLog}>
            {state.importLog.slice(-6).join('\n')}
          </pre>
        )}

        {state.phase === 'error' && (
          <div className={styles.fileError}>{state.error}</div>
        )}
      </div>

      <div className={styles.fileActions}>
        {(state.phase === 'idle' || state.phase === 'error') && (
          <button type="button" className={styles.downloadBtn} onClick={onDownload}>
            ↓ Download
          </button>
        )}
        {state.phase === 'downloading' && (
          <button type="button" className={styles.downloadBtn} disabled>Downloading…</button>
        )}
        {state.phase === 'done' && (
          <button type="button" className={styles.importBtn} onClick={onImport}>
            → Ollama
          </button>
        )}
        {state.phase === 'importing' && (
          <button type="button" className={styles.importBtn} disabled>Importing…</button>
        )}
        {state.phase === 'imported' && (
          <span className={styles.importedLabel}>✔ imported</span>
        )}
      </div>
    </div>
  );
}
