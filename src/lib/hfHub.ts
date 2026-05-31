/**
 * hfHub.ts
 *
 * Thin client for the public Hugging Face Hub REST API.
 * Focus: GGUF model repos and downloadable `.gguf` artifacts.
 */

const HF_API = 'https://huggingface.co/api';

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

export interface HfFile {
  rfilename: string;
  size?: number;
}

export interface HfRepoInfo {
  id: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  tags?: string[];
  siblings: HfFile[];
  private?: boolean;
  gated?: boolean;
  downloads?: number;
  likes?: number;
}

export interface SearchGgufOptions {
  query: string;
  limit?: number;
}

/**
 * Search model repos on Hugging Face, then filter to likely GGUF repos.
 */
export async function searchGgufRepos({ query, limit = 20 }: SearchGgufOptions): Promise<HfSearchItem[]> {
  const url = new URL(`${HF_API}/models`);
  url.searchParams.set('search', query);
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
    return repo.id.toLowerCase().includes('gguf') || tags.some((t) => t.toLowerCase().includes('gguf'));
  });
}

/**
 * Fetch repo details and list files. Used to locate `.gguf` siblings.
 */
export async function getRepoInfo(repoId: string): Promise<HfRepoInfo> {
  const res = await fetch(`${HF_API}/models/${repoId}`);
  if (!res.ok) throw new Error(`HF repo fetch failed: ${res.status}`);
  return (await res.json()) as HfRepoInfo;
}

/**
 * Return only `.gguf` files, sorted by filename.
 */
export function getGgufFiles(repo: HfRepoInfo): HfFile[] {
  return [...(repo.siblings ?? [])]
    .filter((f) => f.rfilename.toLowerCase().endsWith('.gguf'))
    .sort((a, b) => a.rfilename.localeCompare(b.rfilename));
}

/**
 * Convert a repo/file pair into a direct download URL on huggingface.co.
 */
export function buildHfDownloadUrl(repoId: string, filename: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${encodeURIComponent(filename)}`;
}

/**
 * Human-readable bytes for the UI.
 */
export function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
