/**
 * embeddings.ts
 *
 * Thin client for Ollama's /api/embed endpoint + cosine-similarity helpers.
 *
 * Used by the semantic router to convert agent descriptions and user prompts
 * into dense vectors, then rank agents by cosine similarity.
 *
 * Recommended model: nomic-embed-text (274 MB, 768-dim)
 * Pull once with: ollama pull nomic-embed-text
 *
 * Cache strategy:
 *   Agent description embeddings are expensive to compute on every routing call
 *   (N agents × 1 API call each). We cache them in an LRU keyed by a hash of
 *   the agent id + description text so stale vectors are automatically evicted
 *   when the agent's persona.md changes.
 *
 *   The cache is in-memory only and resets on app restart — persistent caching
 *   (via tauri-plugin-store) is a future optimisation.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type EmbeddingVector = number[];

export interface EmbedResult {
  model: string;
  embeddings: EmbeddingVector[];
  total_duration?: number;
}

// ── LRU Cache ─────────────────────────────────────────────────────────────────

const CACHE_MAX = 256;

class LRUCache<K, V> {
  private map = new Map<K, V>();
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val === undefined) return undefined;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      // Evict least recently used (first entry)
      this.map.delete(this.map.keys().next().value as K);
    }
    this.map.set(key, val);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const embeddingCache = new LRUCache<string, EmbeddingVector>(CACHE_MAX);

/** Simple non-cryptographic hash for cache keys — fast enough for short strings. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h.toString(16);
}

function cacheKey(id: string, text: string): string {
  return `${id}::${hashString(text)}`;
}

// ── Ollama Embed API ───────────────────────────────────────────────────────────

/**
 * Fetch embeddings for one or more texts from Ollama.
 *
 * Ollama's /api/embed accepts a list of inputs and returns a list of vectors
 * in the same order. We batch to minimise round-trips.
 */
export async function fetchEmbeddings(
  texts: string[],
  model: string,
  baseUrl: string,
  signal?: AbortSignal
): Promise<EmbeddingVector[]> {
  if (texts.length === 0) return [];

  const res = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[embeddings] Ollama /api/embed returned ${res.status}: ${body}`
    );
  }

  const data: EmbedResult = await res.json();

  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new Error(
      `[embeddings] Expected ${texts.length} embedding(s), got ${
        data.embeddings?.length ?? 0
      }.`
    );
  }

  return data.embeddings;
}

/**
 * Fetch the embedding for a single text with cache support.
 *
 * cacheId is used as part of the cache key — use a stable identifier
 * (e.g. agent.id + agent.frontmatter.description) so the cache auto-invalidates
 * when the description changes.
 */
export async function getEmbedding(
  text: string,
  model: string,
  baseUrl: string,
  cacheId?: string,
  signal?: AbortSignal
): Promise<EmbeddingVector> {
  const key = cacheKey(cacheId ?? text, text);

  const cached = embeddingCache.get(key);
  if (cached) return cached;

  const [vector] = await fetchEmbeddings([text], model, baseUrl, signal);
  embeddingCache.set(key, vector);
  return vector;
}

/**
 * Batch-fetch embeddings for a list of (id, text) pairs, honouring the cache.
 * Only texts that are not already cached are sent to Ollama in a single request.
 */
export async function getBatchEmbeddings(
  items: Array<{ id: string; text: string }>,
  model: string,
  baseUrl: string,
  signal?: AbortSignal
): Promise<Map<string, EmbeddingVector>> {
  const result = new Map<string, EmbeddingVector>();
  const uncached: Array<{ id: string; text: string; key: string }> = [];

  for (const item of items) {
    const key = cacheKey(item.id, item.text);
    const cached = embeddingCache.get(key);
    if (cached) {
      result.set(item.id, cached);
    } else {
      uncached.push({ ...item, key });
    }
  }

  if (uncached.length > 0) {
    const vectors = await fetchEmbeddings(
      uncached.map((u) => u.text),
      model,
      baseUrl,
      signal
    );

    for (let i = 0; i < uncached.length; i++) {
      const { id, key } = uncached[i];
      embeddingCache.set(key, vectors[i]);
      result.set(id, vectors[i]);
    }
  }

  return result;
}

// ── Cosine Similarity ──────────────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors.
 * Returns a value in [-1, 1]; higher = more similar.
 *
 * nomic-embed-text produces L2-normalised vectors, so dot product == cosine.
 * We still compute the full formula for correctness with other models.
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length) {
    throw new Error(
      `[embeddings] Vector dimension mismatch: ${a.length} vs ${b.length}`
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Rank agents by cosine similarity to the query vector.
 * Returns agents sorted descending by score (most similar first).
 */
export function rankBySimilarity(
  queryVector: EmbeddingVector,
  agentVectors: Map<string, EmbeddingVector>
): Array<{ id: string; score: number }> {
  const results: Array<{ id: string; score: number }> = [];

  for (const [id, vec] of agentVectors) {
    results.push({ id, score: cosineSimilarity(queryVector, vec) });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ── Cache utilities (exposed for Settings panel / diagnostics) ────────────────

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

export function embeddingCacheSize(): number {
  return embeddingCache.size;
}
