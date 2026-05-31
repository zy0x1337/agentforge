/**
 * hfHub.ts  v2
 *
 * Thin client for the public Hugging Face Hub REST API.
 * v2 additions:
 *   - Provider filter list
 *   - Quant tag parsing (Q4_K_M, Q6_K, IQ3_XS, …)
 *   - GgufFileInfo with parsed metadata
 *   - Direct download URL builder (unchanged)
 *   - formatBytes helper
 */

const HF_API = 'https://huggingface.co/api';

// ─── Known GGUF providers ──────────────────────────────────────────────────

export const KNOWN_PROVIDERS = [
  'all',
  'bartowski',
  'TheBloke',
  'lmstudio-community',
  'unsloth',
  'ggml-org',
  'mradermacher',
] as const;

export type Provider = (typeof KNOWN_PROVIDERS)[number];

// ─── Search / repo types ───────────────────────────────────────────────────

export interface HfSearchItem {
  id: string;
  author?: string;
  likes?: number;
  downloads?: number;
  private?: boolean;
  gated?: boolean;
  lastModified?: string;
  tags?: string[];
  pipeline_tag?: string;
}

export interface HfRawFile {
  rfilename: string;
  size?: number;
}

export interface HfRepoInfo {
  id: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  tags?: string[];
  siblings: HfRawFile[];
  private?: boolean;
  gated?: boolean;
  downloads?: number;
  likes?: number;
}

// ─── Quant parsing ─────────────────────────────────────────────────────────

/**
 * Recognised quant families, ordered from smallest to largest (approx).
 * Used for sorting and display.
 */
export const QUANT_ORDER = [
  'IQ1_S', 'IQ1_M',
  'IQ2_XXS', 'IQ2_XS', 'IQ2_S', 'IQ2_M',
  'IQ3_XXS', 'IQ3_XS', 'IQ3_S', 'IQ3_M',
  'Q2_K', 'Q2_K_S',
  'IQ4_XS', 'IQ4_NL',
  'Q3_K_S', 'Q3_K_M', 'Q3_K_L',
  'Q4_0', 'Q4_1', 'Q4_K_S', 'Q4_K_M',
  'Q5_0', 'Q5_1', 'Q5_K_S', 'Q5_K_M',
  'Q6_K',
  'Q8_0',
  'F16', 'BF16', 'F32',
] as const;

export type QuantTag = (typeof QUANT_ORDER)[number] | 'UNKNOWN';

/**
 * Extract a quant tag from a `.gguf` filename.
 * e.g. "Qwen2.5-7B-Instruct-Q4_K_M.gguf" → "Q4_K_M"
 */
export function parseQuantTag(filename: string): QuantTag {
  const upper = filename.toUpperCase();
  // Longest match first (Q3_K_M before Q3_K)
  const sorted = [...QUANT_ORDER].sort((a, b) => b.length - a.length);
  for (const tag of sorted) {
    if (upper.includes(tag)) return tag as QuantTag;
  }
  return 'UNKNOWN';
}

/** Relative quality index 0–1 for progress bars (higher = better quality / larger). */
export function quantQualityRatio(tag: QuantTag): number {
  const idx = QUANT_ORDER.indexOf(tag as (typeof QUANT_ORDER)[number]);
  if (idx === -1) return 0.5;
  return idx / (QUANT_ORDER.length - 1);
}

// ─── Enriched file type ────────────────────────────────────────────────────

export interface GgufFileInfo extends HfRawFile {
  quantTag: QuantTag;
  qualityRatio: number; // 0–1
}

export type SortKey = 'name' | 'size' | 'quant';

// ─── API functions ─────────────────────────────────────────────────────────

export interface SearchGgufOptions {
  query: string;
  provider?: Provider;
  limit?: number;
}

/**
 * Search model repos on Hugging Face.
 * When provider ≠ 'all', prepends the author: prefix to the query.
 * Results are filtered to likely GGUF repos.
 */
export async function searchGgufRepos({
  query,
  provider = 'all',
  limit = 20,
}: SearchGgufOptions): Promise<HfSearchItem[]> {
  const url = new URL(`${HF_API}/models`);

  const fullQuery = provider !== 'all' ? `${provider}/${query}` : query;
  url.searchParams.set('search', fullQuery);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('full', 'false');
  url.searchParams.set('config', 'false');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HF search failed: ${res.status}`);

  const data = (await res.json()) as HfSearchItem[];

  return data.filter((repo) => {
    const tags = repo.tags ?? [];
    const authorMatch = provider !== 'all'
      ? (repo.author ?? '').toLowerCase() === provider.toLowerCase()
      : true;
    const isGguf =
      repo.id.toLowerCase().includes('gguf') ||
      tags.some((t) => t.toLowerCase().includes('gguf'));
    return authorMatch && isGguf;
  });
}

/** Fetch full repo info including siblings[]. */
export async function getRepoInfo(repoId: string): Promise<HfRepoInfo> {
  const res = await fetch(`${HF_API}/models/${repoId}`);
  if (!res.ok) throw new Error(`HF repo fetch failed: ${res.status}`);
  return (await res.json()) as HfRepoInfo;
}

/**
 * Return enriched GgufFileInfo objects for all `.gguf` siblings.
 * Default sort: quant order (smallest first).
 */
export function getGgufFiles(
  repo: HfRepoInfo,
  sortBy: SortKey = 'quant',
): GgufFileInfo[] {
  const files: GgufFileInfo[] = (repo.siblings ?? [])
    .filter((f) => f.rfilename.toLowerCase().endsWith('.gguf'))
    .map((f) => {
      const quantTag = parseQuantTag(f.rfilename);
      return {
        ...f,
        quantTag,
        qualityRatio: quantQualityRatio(quantTag),
      };
    });

  return sortGgufFiles(files, sortBy);
}

export function sortGgufFiles(files: GgufFileInfo[], sortBy: SortKey): GgufFileInfo[] {
  return [...files].sort((a, b) => {
    if (sortBy === 'size') return (a.size ?? 0) - (b.size ?? 0);
    if (sortBy === 'quant') return a.qualityRatio - b.qualityRatio;
    return a.rfilename.localeCompare(b.rfilename);
  });
}

/** Direct download URL for a HF repo file. */
export function buildHfDownloadUrl(repoId: string, filename: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${encodeURIComponent(filename)}`;
}

// ─── Formatting helpers ────────────────────────────────────────────────────

export function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
