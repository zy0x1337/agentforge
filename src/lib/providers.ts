/**
 * providers.ts
 * Known Hugging Face GGUF provider/organisation definitions with
 * display metadata, trust level, and search-query helpers.
 */

export interface ProviderDefinition {
  /** HF organisation slug (used in repo paths: {org}/{model}) */
  id: string;
  /** Display name shown in UI */
  displayName: string;
  /** Short description of what this provider specialises in */
  description: string;
  /** Recommended for most users */
  recommended: boolean;
  /** HF profile URL */
  profileUrl: string;
  /** Known naming conventions for this provider's files */
  filePattern?: RegExp;
  /** Badge colour token */
  colorToken: string;
}

export const KNOWN_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'bartowski',
    displayName: 'bartowski',
    description: 'High-quality GGUF quants with IQ variants, consistently updated',
    recommended: true,
    profileUrl: 'https://huggingface.co/bartowski',
    filePattern: /bartowski/i,
    colorToken: 'var(--color-primary)',
  },
  {
    id: 'TheBloke',
    displayName: 'TheBloke',
    description: 'Pioneering GGUF quantiser — vast model catalogue, slightly older format',
    recommended: true,
    profileUrl: 'https://huggingface.co/TheBloke',
    filePattern: /thebloke/i,
    colorToken: 'var(--color-blue)',
  },
  {
    id: 'lmstudio-community',
    displayName: 'LM Studio',
    description: 'Official LM Studio community quants, optimised for LM Studio / llama.cpp',
    recommended: true,
    profileUrl: 'https://huggingface.co/lmstudio-community',
    filePattern: /lmstudio/i,
    colorToken: 'var(--color-purple)',
  },
  {
    id: 'unsloth',
    displayName: 'Unsloth',
    description: 'Dynamic quants (DQ) + fine-tuned models; often smaller files at same quality',
    recommended: true,
    profileUrl: 'https://huggingface.co/unsloth',
    filePattern: /unsloth/i,
    colorToken: 'var(--color-orange)',
  },
  {
    id: 'mradermacher',
    displayName: 'mradermacher',
    description: 'Broad GGUF coverage including rare models',
    recommended: false,
    profileUrl: 'https://huggingface.co/mradermacher',
    colorToken: 'var(--color-gold)',
  },
  {
    id: 'QuantFactory',
    displayName: 'QuantFactory',
    description: 'Automated GGUF pipeline across many model families',
    recommended: false,
    profileUrl: 'https://huggingface.co/QuantFactory',
    colorToken: 'var(--color-success)',
  },
];

/** Returns the provider definition for a repo path like "bartowski/Llama-3.1-8B-Instruct-GGUF" */
export function detectProvider(repoId: string): ProviderDefinition | undefined {
  const org = repoId.split('/')[0]?.toLowerCase();
  return KNOWN_PROVIDERS.find((p) => p.id.toLowerCase() === org);
}

/** Build a Hugging Face search URL scoped to a specific provider */
export function hfSearchUrl(query: string, providerId?: string): string {
  const base = 'https://huggingface.co/models';
  const params = new URLSearchParams({
    search: providerId ? `${providerId} ${query}` : query,
    filter: 'gguf',
  });
  return `${base}?${params.toString()}`;
}
