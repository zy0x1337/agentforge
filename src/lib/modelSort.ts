/**
 * modelSort.ts
 * Sorting and filtering utilities for GGUF file metadata.
 * Works with data returned by fetchHfRepoFiles + parseQuantFromFilename.
 */

import { parseQuantFromFilename, getQuantInfo, type QuantLevel } from './quantParser';
import { detectProvider, type ProviderDefinition } from './providers';

// ---------------------------------------------------------------------------
// Enriched file record
// ---------------------------------------------------------------------------

export interface EnrichedGgufFile {
  repoId: string;
  filename: string;
  sizeBytes: number;
  sizeMb: number;
  sha256?: string;
  quantTag: QuantLevel;
  bpw: number;
  qualityTier: string;
  vramEstimateGb: number;
  paramsBillions?: number;
  provider?: ProviderDefinition;
}

// ---------------------------------------------------------------------------
// Enrich
// ---------------------------------------------------------------------------

/**
 * Attaches quant metadata and provider info to a raw HF file entry.
 *
 * @param repoId        - e.g. "bartowski/Llama-3.1-8B-Instruct-GGUF"
 * @param filename      - e.g. "Llama-3.1-8B-Instruct-Q4_K_M.gguf"
 * @param sizeBytes     - file size from HF API
 * @param sha256        - optional SHA256 from LFS pointer
 * @param paramsBillions - optional param count for VRAM estimate
 */
export function enrichGgufFile(
  repoId: string,
  filename: string,
  sizeBytes: number,
  sha256?: string,
  paramsBillions?: number,
): EnrichedGgufFile {
  const quantTag = parseQuantFromFilename(filename);
  const info = getQuantInfo(quantTag);
  const vramEstimateGb =
    paramsBillions != null
      ? Math.ceil((paramsBillions * 1e9 * info.bpw) / 8 / 1024 / 1024 / 1024 * 1.15 * 10) / 10
      : 0;

  return {
    repoId,
    filename,
    sizeBytes,
    sizeMb: Math.round((sizeBytes / 1024 / 1024) * 10) / 10,
    sha256,
    quantTag,
    bpw: info.bpw,
    qualityTier: info.qualityTier,
    vramEstimateGb,
    paramsBillions,
    provider: detectProvider(repoId),
  };
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export type SortField = 'filename' | 'sizeBytes' | 'bpw' | 'vramEstimateGb' | 'qualityTier';
export type SortDirection = 'asc' | 'desc';

const TIER_ORDER: Record<string, number> = {
  'ultra-low': 0,
  'compressed': 1,
  'balanced': 2,
  'high': 3,
  'extreme': 4,
};

export function sortGgufFiles(
  files: EnrichedGgufFile[],
  field: SortField,
  direction: SortDirection = 'asc',
): EnrichedGgufFile[] {
  const sorted = [...files].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'filename':
        cmp = a.filename.localeCompare(b.filename);
        break;
      case 'sizeBytes':
        cmp = a.sizeBytes - b.sizeBytes;
        break;
      case 'bpw':
        cmp = a.bpw - b.bpw;
        break;
      case 'vramEstimateGb':
        cmp = a.vramEstimateGb - b.vramEstimateGb;
        break;
      case 'qualityTier':
        cmp = (TIER_ORDER[a.qualityTier] ?? 2) - (TIER_ORDER[b.qualityTier] ?? 2);
        break;
    }
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export interface FilterOptions {
  /** Only show files matching these quant tiers */
  qualityTiers?: string[];
  /** Only show files from these provider IDs */
  providerIds?: string[];
  /** Max file size in MB */
  maxSizeMb?: number;
  /** Min file size in MB */
  minSizeMb?: number;
  /** Search string matched against filename */
  search?: string;
}

export function filterGgufFiles(
  files: EnrichedGgufFile[],
  opts: FilterOptions,
): EnrichedGgufFile[] {
  return files.filter((f) => {
    if (opts.qualityTiers?.length && !opts.qualityTiers.includes(f.qualityTier)) return false;
    if (opts.providerIds?.length && !opts.providerIds.includes(f.provider?.id ?? '')) return false;
    if (opts.maxSizeMb != null && f.sizeMb > opts.maxSizeMb) return false;
    if (opts.minSizeMb != null && f.sizeMb < opts.minSizeMb) return false;
    if (opts.search && !f.filename.toLowerCase().includes(opts.search.toLowerCase())) return false;
    return true;
  });
}
