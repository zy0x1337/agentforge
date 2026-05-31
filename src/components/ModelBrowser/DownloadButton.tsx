/**
 * DownloadButton.tsx
 * Single-file download button with inline progress bar,
 * cancel support, and post-download Ollama import option.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  downloadGguf,
  importIntoOllama,
  selectModelsFolder,
  getModelsFolder,
  type DownloadProgress,
  type HfFileEntry,
} from '../../lib/modelDownloader';

interface Props {
  file: HfFileEntry;
  /** Absolute path if this file is already present locally */
  localPath?: string;
}

type Stage = 'idle' | 'downloading' | 'done' | 'error' | 'importing' | 'imported';

export const DownloadButton: React.FC<Props> = ({ file, localPath: existingPath }) => {
  const [stage, setStage] = useState<Stage>(existingPath ? 'done' : 'idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(existingPath ?? null);
  const [importedName, setImportedName] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => () => { unlistenRef.current?.(); }, []);

  const handleDownload = async () => {
    let folder = getModelsFolder();
    if (!folder) {
      folder = await selectModelsFolder();
      if (!folder) return; // user cancelled folder picker
    }

    setStage('downloading');
    setErrorMsg(null);

    try {
      const handle = await downloadGguf(file, folder);
      cancelRef.current = handle.cancel;
      unlistenRef.current = handle.onProgress((p) => {
        setProgress(p);
        if (p.status === 'done') {
          setStage('done');
          setDownloadedPath(`${folder}/${file.filename}`);
        } else if (p.status === 'error') {
          setStage('error');
          setErrorMsg(p.errorMessage ?? 'Download failed');
        } else if (p.status === 'cancelled') {
          setStage('idle');
          setProgress(null);
        }
      });
    } catch (err) {
      setStage('error');
      setErrorMsg(String(err));
    }
  };

  const handleCancel = () => { cancelRef.current?.(); };

  const handleOllamaImport = async () => {
    if (!downloadedPath) return;
    setStage('importing');
    const result = await importIntoOllama(downloadedPath);
    if (result.success) {
      setImportedName(result.modelName);
      setStage('imported');
    } else {
      setStage('error');
      setErrorMsg(result.errorMessage ?? 'Import failed');
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const pct = progress?.percent ?? 0;
  const speedMbs = progress ? (progress.speed / 1024 / 1024).toFixed(1) : '0.0';

  const btnBase: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    borderRadius: 'var(--radius-md)',
    padding: '6px 14px',
    cursor: 'pointer',
    transition: 'background var(--transition-interactive)',
    border: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    whiteSpace: 'nowrap',
  };

  if (stage === 'idle') {
    return (
      <button
        onClick={handleDownload}
        style={{ ...btnBase, background: 'var(--color-primary)', color: '#fff' }}
      >
        ↓ Download
      </button>
    );
  }

  if (stage === 'downloading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 180 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          <span>{pct}%</span>
          <span>{speedMbs} MB/s</span>
        </div>
        <div style={{ background: 'var(--color-surface-offset)', borderRadius: 'var(--radius-full)', height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.3s ease', borderRadius: 'var(--radius-full)' }} />
        </div>
        <button onClick={handleCancel} style={{ ...btnBase, background: 'var(--color-surface-dynamic)', color: 'var(--color-text-muted)', padding: '3px 10px', fontSize: 'var(--text-xs)' }}>
          Cancel
        </button>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 600 }}>✓ Downloaded</span>
        <button
          onClick={handleOllamaImport}
          style={{ ...btnBase, background: 'var(--color-surface-offset)', color: 'var(--color-text)', fontSize: 'var(--text-xs)', padding: '4px 10px' }}
          title="Create Ollama model from local file"
        >
          Import into Ollama
        </button>
      </div>
    );
  }

  if (stage === 'importing') {
    return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>⟳ Importing into Ollama…</span>;
  }

  if (stage === 'imported') {
    return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 600 }}>✓ Ollama: {importedName}</span>;
  }

  if (stage === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>{errorMsg}</span>
        <button onClick={handleDownload} style={{ ...btnBase, background: 'var(--color-error)', color: '#fff', fontSize: 'var(--text-xs)', padding: '4px 10px' }}>
          Retry
        </button>
      </div>
    );
  }

  return null;
};
