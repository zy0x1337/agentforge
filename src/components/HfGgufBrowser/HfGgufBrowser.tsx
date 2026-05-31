import React, { useMemo, useState } from 'react';
import {
  buildHfDownloadUrl,
  formatBytes,
  getGgufFiles,
  getRepoInfo,
  HfFile,
  HfRepoInfo,
  HfSearchItem,
  searchGgufRepos,
} from '../../lib/hfHub';
import styles from './HfGgufBrowser.module.css';

type Status = 'idle' | 'loading' | 'error';

function formatDate(value?: string): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function HfGgufBrowser() {
  const [query, setQuery] = useState('qwen gguf');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<HfSearchItem[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<HfRepoInfo | null>(null);
  const [repoStatus, setRepoStatus] = useState<Status>('idle');
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const ggufFiles = useMemo(() => (selectedRepo ? getGgufFiles(selectedRepo) : []), [selectedRepo]);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setStatus('loading');
    setError(null);
    setSelectedRepo(null);
    setActiveRepoId(null);
    try {
      const data = await searchGgufRepos({ query, limit: 20 });
      setResults(data);
      if (data.length === 0) setError('No GGUF repositories found for this query.');
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  async function handleOpenRepo(repoId: string) {
    setRepoStatus('loading');
    setError(null);
    setActiveRepoId(repoId);
    try {
      const repo = await getRepoInfo(repoId);
      setSelectedRepo(repo);
      setRepoStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRepoStatus('error');
    }
  }

  async function handleDownload(repoId: string, file: HfFile) {
    const url = buildHfDownloadUrl(repoId, file.rfilename);
    setDownloading(file.rfilename);
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      window.setTimeout(() => setDownloading(null), 800);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Hugging Face GGUF Browser</h2>
          <p className={styles.subtitle}>
            Search public Hugging Face model repositories, inspect GGUF files, and open official download URLs.
          </p>
        </div>
      </div>

      <form className={styles.searchBar} onSubmit={handleSearch}>
        <input
          className={styles.input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GGUF repos, e.g. llama 3 gguf"
          aria-label="Search Hugging Face GGUF repositories"
        />
        <button className={styles.searchBtn} type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Repositories</h3>
            <span className={styles.meta}>{results.length} results</span>
          </div>

          <div className={styles.repoList}>
            {results.map((repo) => {
              const active = activeRepoId === repo.id;
              return (
                <button
                  key={repo.id}
                  type="button"
                  className={`${styles.repoCard} ${active ? styles.repoCardActive : ''}`}
                  onClick={() => handleOpenRepo(repo.id)}
                >
                  <div className={styles.repoTop}>
                    <span className={styles.repoId}>{repo.id}</span>
                    {repo.gated && <span className={styles.badge}>gated</span>}
                  </div>
                  <div className={styles.repoMeta}>
                    <span>↓ {repo.downloads ?? 0}</span>
                    <span>♥ {repo.likes ?? 0}</span>
                    <span>{formatDate(repo.lastModified)}</span>
                  </div>
                </button>
              );
            })}

            {results.length === 0 && status !== 'loading' && (
              <div className={styles.empty}>No repositories loaded yet.</div>
            )}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>GGUF Files</h3>
            <span className={styles.meta}>
              {selectedRepo ? selectedRepo.id : 'Select a repository'}
            </span>
          </div>

          {!selectedRepo && repoStatus !== 'loading' && (
            <div className={styles.empty}>Open a repository to inspect available `.gguf` files.</div>
          )}

          {repoStatus === 'loading' && <div className={styles.empty}>Loading repository…</div>}

          {selectedRepo && repoStatus !== 'loading' && (
            <>
              <div className={styles.repoSummary}>
                <div><strong>Author:</strong> {selectedRepo.author ?? '—'}</div>
                <div><strong>Updated:</strong> {formatDate(selectedRepo.lastModified)}</div>
                <div><strong>Downloads:</strong> {selectedRepo.downloads ?? 0}</div>
                <div><strong>Likes:</strong> {selectedRepo.likes ?? 0}</div>
              </div>

              <div className={styles.fileList}>
                {ggufFiles.map((file) => (
                  <div key={file.rfilename} className={styles.fileRow}>
                    <div className={styles.fileInfo}>
                      <code className={styles.fileName}>{file.rfilename}</code>
                      <span className={styles.fileSize}>{formatBytes(file.size)}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.downloadBtn}
                      onClick={() => handleDownload(selectedRepo.id, file)}
                      disabled={downloading === file.rfilename}
                    >
                      {downloading === file.rfilename ? 'Opening…' : 'Download'}
                    </button>
                  </div>
                ))}

                {ggufFiles.length === 0 && (
                  <div className={styles.empty}>This repository has no `.gguf` files.</div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
