/**
 * quantParser.ts
 * Parses GGUF quantization tags from filenames and provides
 * human-readable labels, quality ratings, and size estimates.
 */

export type QuantLevel =
  | 'Q2_K'
  | 'Q3_K_S' | 'Q3_K_M' | 'Q3_K_L'
  | 'Q4_0' | 'Q4_1'
  | 'Q4_K_S' | 'Q4_K_M'
  | 'Q5_0' | 'Q5_1'
  | 'Q5_K_S' | 'Q5_K_M'
  | 'Q6_K'
  | 'Q8_0'
  | 'F16' | 'F32'
  | 'IQ1_S' | 'IQ2_XXS' | 'IQ2_XS' | 'IQ2_M' | 'IQ3_S' | 'IQ3_M' | 'IQ4_NL' | 'IQ4_XS'
  | 'BF16'
  | 'UNKNOWN';

export type QualityTier = 'extreme' | 'high' | 'balanced' | 'compressed' | 'ultra-low';

export interface QuantInfo {
  tag: QuantLevel;
  label: string;
  qualityTier: QualityTier;
  /** Bits per weight (approximate) */
  bpw: number;
  /** Short description for UI tooltip */
  description: string;
  /** Relative VRAM multiplier vs F16 (0–1) */
  vramFactor: number;
  /** Recommended use case */
  useCase: string;
}

const QUANT_MAP: Record<string, QuantInfo> = {
  Q2_K:     { tag: 'Q2_K',     label: 'Q2_K',     qualityTier: 'ultra-low',   bpw: 2.6,  description: 'Ultra-compressed, significant quality loss',        vramFactor: 0.16, useCase: 'Minimum VRAM / testing only' },
  IQ1_S:    { tag: 'IQ1_S',    label: 'IQ1_S',    qualityTier: 'ultra-low',   bpw: 1.6,  description: 'Importance-matrix quant, 1-bit base',               vramFactor: 0.10, useCase: 'Extreme edge / not recommended for production' },
  IQ2_XXS:  { tag: 'IQ2_XXS',  label: 'IQ2_XXS',  qualityTier: 'ultra-low',   bpw: 2.1,  description: 'IQ 2-bit extra extra small',                        vramFactor: 0.13, useCase: 'Tiny VRAM budgets' },
  IQ2_XS:   { tag: 'IQ2_XS',   label: 'IQ2_XS',   qualityTier: 'ultra-low',   bpw: 2.3,  description: 'IQ 2-bit extra small',                             vramFactor: 0.14, useCase: 'Tiny VRAM budgets' },
  IQ2_M:    { tag: 'IQ2_M',    label: 'IQ2_M',    qualityTier: 'ultra-low',   bpw: 2.5,  description: 'IQ 2-bit medium',                                  vramFactor: 0.16, useCase: 'Smallest usable quality' },
  Q3_K_S:   { tag: 'Q3_K_S',   label: 'Q3_K_S',   qualityTier: 'ultra-low',   bpw: 3.0,  description: '3-bit K-quant small',                              vramFactor: 0.19, useCase: 'Extreme compression' },
  Q3_K_M:   { tag: 'Q3_K_M',   label: 'Q3_K_M',   qualityTier: 'compressed',  bpw: 3.3,  description: '3-bit K-quant medium — acceptable for simple tasks', vramFactor: 0.21, useCase: 'Low-end GPU / iGPU' },
  Q3_K_L:   { tag: 'Q3_K_L',   label: 'Q3_K_L',   qualityTier: 'compressed',  bpw: 3.6,  description: '3-bit K-quant large',                              vramFactor: 0.23, useCase: 'Low-end GPU' },
  IQ3_S:    { tag: 'IQ3_S',    label: 'IQ3_S',    qualityTier: 'compressed',  bpw: 3.0,  description: 'IQ 3-bit small',                                   vramFactor: 0.19, useCase: 'Better than Q3_K_S at same size' },
  IQ3_M:    { tag: 'IQ3_M',    label: 'IQ3_M',    qualityTier: 'compressed',  bpw: 3.2,  description: 'IQ 3-bit medium',                                  vramFactor: 0.20, useCase: 'Better than Q3_K_M at same size' },
  Q4_0:     { tag: 'Q4_0',     label: 'Q4_0',     qualityTier: 'balanced',    bpw: 4.0,  description: 'Original 4-bit, legacy format',                    vramFactor: 0.25, useCase: 'Compatibility / older models' },
  Q4_1:     { tag: 'Q4_1',     label: 'Q4_1',     qualityTier: 'balanced',    bpw: 4.5,  description: '4-bit with scale factor, slightly better than Q4_0', vramFactor: 0.28, useCase: 'Compatibility / older models' },
  Q4_K_S:   { tag: 'Q4_K_S',   label: 'Q4_K_S',   qualityTier: 'balanced',    bpw: 4.4,  description: '4-bit K-quant small — good speed/quality tradeoff', vramFactor: 0.28, useCase: 'Everyday use, mid-range GPU' },
  Q4_K_M:   { tag: 'Q4_K_M',   label: 'Q4_K_M',   qualityTier: 'balanced',    bpw: 4.8,  description: '4-bit K-quant medium — recommended default',        vramFactor: 0.30, useCase: '⭐ Best all-round choice' },
  IQ4_NL:   { tag: 'IQ4_NL',   label: 'IQ4_NL',   qualityTier: 'balanced',    bpw: 4.5,  description: 'IQ 4-bit non-linear',                              vramFactor: 0.28, useCase: 'Better quality than Q4_K_S' },
  IQ4_XS:   { tag: 'IQ4_XS',   label: 'IQ4_XS',   qualityTier: 'balanced',    bpw: 4.3,  description: 'IQ 4-bit extra small',                             vramFactor: 0.27, useCase: 'Small 4-bit with IQ quality' },
  Q5_0:     { tag: 'Q5_0',     label: 'Q5_0',     qualityTier: 'high',        bpw: 5.0,  description: '5-bit original, legacy format',                    vramFactor: 0.31, useCase: 'Compatibility / older models' },
  Q5_1:     { tag: 'Q5_1',     label: 'Q5_1',     qualityTier: 'high',        bpw: 5.5,  description: '5-bit with scale factor',                          vramFactor: 0.34, useCase: 'Compatibility' },
  Q5_K_S:   { tag: 'Q5_K_S',   label: 'Q5_K_S',   qualityTier: 'high',        bpw: 5.4,  description: '5-bit K-quant small',                              vramFactor: 0.34, useCase: 'High quality on mid-range GPU' },
  Q5_K_M:   { tag: 'Q5_K_M',   label: 'Q5_K_M',   qualityTier: 'high',        bpw: 5.7,  description: '5-bit K-quant medium — near-lossless',             vramFactor: 0.36, useCase: 'High quality, 8GB+ VRAM' },
  Q6_K:     { tag: 'Q6_K',     label: 'Q6_K',     qualityTier: 'high',        bpw: 6.6,  description: '6-bit K-quant — near-F16 quality',                 vramFactor: 0.41, useCase: 'Maximum quality with compression' },
  Q8_0:     { tag: 'Q8_0',     label: 'Q8_0',     qualityTier: 'extreme',     bpw: 8.0,  description: 'Almost lossless, fast inference',                  vramFactor: 0.50, useCase: '16GB+ VRAM, reference quality' },
  BF16:     { tag: 'BF16',     label: 'BF16',     qualityTier: 'extreme',     bpw: 16.0, description: 'Brain float 16 — full precision on Ampere+',       vramFactor: 1.00, useCase: 'Training / fine-tuning / max precision' },
  F16:      { tag: 'F16',      label: 'F16',      qualityTier: 'extreme',     bpw: 16.0, description: 'Full float16 precision',                           vramFactor: 1.00, useCase: 'Maximum quality, large VRAM only' },
  F32:      { tag: 'F32',      label: 'F32',      qualityTier: 'extreme',     bpw: 32.0, description: 'Full float32 precision',                           vramFactor: 2.00, useCase: 'Training only' },
};

/** Extract quant tag from a GGUF filename, e.g. "mistral-7b-Q4_K_M.gguf" → "Q4_K_M" */
export function parseQuantFromFilename(filename: string): QuantLevel {
  // Normalise and strip extension
  const base = filename.replace(/\.gguf$/i, '').toUpperCase();

  // Sorted longest-first so IQ4_XS matches before Q4 etc.
  const knownTags = Object.keys(QUANT_MAP).sort((a, b) => b.length - a.length);

  for (const tag of knownTags) {
    // Match tag surrounded by separators (-, _, .) or at end of string
    const re = new RegExp(`(?:[-_.]|^)${tag.replace(/_/g, '[_-]')}(?:[-_.]|$)`);
    if (re.test(base)) return tag as QuantLevel;
  }
  return 'UNKNOWN';
}

export function getQuantInfo(tag: QuantLevel): QuantInfo {
  return (
    QUANT_MAP[tag] ?? {
      tag: 'UNKNOWN',
      label: 'Unknown',
      qualityTier: 'balanced',
      bpw: 0,
      description: 'Unrecognised quantisation',
      vramFactor: 0,
      useCase: 'Unknown',
    }
  );
}

/** Estimate VRAM required given a parameter count (billions) and quant tag */
export function estimateVramGb(paramsBillions: number, tag: QuantLevel): number {
  const info = getQuantInfo(tag);
  // Each parameter = bpw bits; convert to GB
  const rawGb = (paramsBillions * 1e9 * info.bpw) / 8 / 1024 / 1024 / 1024;
  // Add ~15% overhead for KV cache and activation buffers
  return Math.ceil(rawGb * 1.15 * 10) / 10;
}

/** Tier colour token for UI badge styling */
export function tierColorToken(tier: QualityTier): string {
  const map: Record<QualityTier, string> = {
    'extreme':    'var(--color-primary)',
    'high':       'var(--color-success)',
    'balanced':   'var(--color-gold)',
    'compressed': 'var(--color-warning)',
    'ultra-low':  'var(--color-error)',
  };
  return map[tier];
}
