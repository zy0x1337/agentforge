/**
 * ModelFileTable.tsx
 * Sortable table of GGUF files for a single HF repo.
 * Combines QuantBadge, ProviderFilter, DownloadButton and the
 * sort/filter utilities from modelSort.ts.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchHfRepoFiles } from '../../lib/modelDownloader';
import { enrichGgufFile, sortGgufFiles, filterGgufFiles, type EnrichedGgufFile, type SortField, type SortDirection } from '../../lib/modelSort';
import { QuantBadge } from './QuantBadge';
import { ProviderFilter } from './ProviderFilter';
import { DownloadButton } from './DownloadButton';

interface Props {
  repoId: string;
  /** Estimated parameter count for VRAM estimates */
  paramsBillions?: number;
  /** Map of filename → local absolute path for already-downloaded files */
  localFiles?: Record<string, string>;
}

const TIER_LABELS: Record<string, string> = {
  'ultra-low': 'Ultra-low',
  'compressed': 'Compressed',
  'balanced': 'Balanced',
  'high': 'High',
  'extreme': 'Extreme',
};

function fmt(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export const ModelFileTable: React.FC<Props> = ({ repoId, paramsBillions, localFiles = {} }) => {
  const [files, setFiles] = useState<EnrichedGgufFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('bpw');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Filter state
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [selectedTiers, setSelectedTiers] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHfRepoFiles(repoId)
      .then((raw) => {
        if (cancelled) return;
        const enriched = raw.map((f) =>
          enrichGgufFile(repoId, f.rfilename, f.lfs?.size ?? f.size, f.lfs?.sha256, paramsBillions),
        );
        setFiles(enriched);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [repoId, paramsBillions]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return field;
    });
  }, []);

  const processed = useMemo(() => {
    const filtered = filterGgufFiles(files, {
      qualityTiers: selectedTiers.length ? selectedTiers : undefined,
      providerIds: selectedProviders.length ? selectedProviders : undefined,
      search: search || undefined,
    });
    return sortGgufFiles(filtered, sortField, sortDir);
  }, [files, selectedTiers, selectedProviders, search, sortField, sortDir]);

  const SortHeader: React.FC<{ field: SortField; label: string }> = ({ field, label }) => (
    <th
      onClick={() => handleSort(field)}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        padding: 'var(--space-2) var(--space-3)',
        textAlign: 'left',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: sortField === field ? 'var(--color-primary)' : 'var(--color-text-muted)',
        borderBottom: '1px solid var(--color-border)',
        whiteSpace: 'nowrap',
      }}
    >
      {label} {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Loading files…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>
        Failed to load: {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Search */}
        <input
          type="search"
          placeholder="Filter files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            fontSize: 'var(--text-sm)',
            minWidth: 200,
          }}
        />

        {/* Quality tier filter chips */}
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', alignItems: 'center' }}>
          {Object.entries(TIER_LABELS).map(([tier, label]) => {
            const active = selectedTiers.includes(tier);
            return (
              <button
                key={tier}
                onClick={() =>
                  setSelectedTiers((prev) =>
                    prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier],
                  )
                }
                style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: active ? 700 : 400,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-primary-highlight)' : 'var(--color-surface)',
                  color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-interactive)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Provider filter */}
        <ProviderFilter selected={selectedProviders} onChange={setSelectedProviders} />
      </div>

      {/* Count */}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
        {processed.length} of {files.length} files
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
        <table style={{ width: '100%', fontSize: 'var(--text-sm)', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-offset)' }}>
              <SortHeader field="filename" label="Filename" />
              <SortHeader field="bpw" label="Quant" />
              <SortHeader field="qualityTier" label="Quality" />
              <SortHeader field="sizeBytes" label="Size" />
              <SortHeader field="vramEstimateGb" label="VRAM est." />
              <th style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {processed.map((f, i) => {
              const isLocal = f.filename in localFiles;
              return (
                <tr
                  key={f.filename}
                  style={{
                    background: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-2)',
                    borderBottom: '1px solid var(--color-divider)',
                  }}
                >
                  <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-xs)', color: 'var(--color-text)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isLocal && <span style={{ color: 'var(--color-success)', marginRight: 4 }}>●</span>}
                    {f.filename}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    <QuantBadge tag={f.quantTag} showBpw />
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                    {TIER_LABELS[f.qualityTier] ?? f.qualityTier}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(f.sizeBytes)}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {f.vramEstimateGb > 0 ? `~${f.vramEstimateGb} GB` : '—'}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    <DownloadButton
                      file={{ repoId: f.repoId, filename: f.filename, sizeBytes: f.sizeBytes, sha256: f.sha256 }}
                      localPath={localFiles[f.filename]}
                    />
                  </td>
                </tr>
              );
            })}
            {processed.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  No files match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
