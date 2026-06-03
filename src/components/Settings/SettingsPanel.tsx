/**
 * SettingsPanel — slide-over drawer from the right.
 *
 * Sections:
 *   1. LLM — default model selector, Ollama base URL
 *   2. Agents — agents directory path (folder picker via Tauri dialog)
 *   3. Routing — embed model, routing mode radio, semantic threshold
 *   4. Appearance — theme toggle
 *   5. Diagnostics — embedding cache size, clear cache button, version
 *
 * All changes are persisted immediately via useAppStore.updateSettings.
 * The panel closes on Escape or clicking the backdrop.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/useAppStore";
import { clearEmbeddingCache, embeddingCacheSize } from "@/lib/embeddings";
import { DEFAULT_EMBED_MODEL } from "@/lib/router";
import styles from "./SettingsPanel.module.css";

// ── Types ───────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

type RoutingMode = "full" | "no-semantic" | "rules-only";

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className={styles.sectionHeader}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {description && <p className={styles.sectionDesc}>{description}</p>}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </div>
  );
}

function TextInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  monospace = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  monospace?: boolean;
}) {
  return (
    <input
      id={id}
      className={`${styles.input} ${monospace ? styles.mono : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
    />
  );
}

function RadioGroup<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: string; description: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles.radioGroup} role="radiogroup">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`${styles.radioOption} ${
            value === opt.value ? styles.radioSelected : ""
          }`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className={styles.radioInput}
          />
          <span className={styles.radioMark} aria-hidden />
          <span className={styles.radioContent}>
            <span className={styles.radioLabel}>{opt.label}</span>
            <span className={styles.radioDesc}>{opt.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function SettingsPanel({ open, onClose }: Props) {
  const { settings, updateSettings, localModels } = useAppStore();

  // Local draft state — only persisted on blur / change commit
  const [ollamaUrl, setOllamaUrl]     = useState(settings.ollamaBaseUrl);
  const [embedModel, setEmbedModel]   = useState(
    settings.embedModel ?? DEFAULT_EMBED_MODEL
  );
  const [routingMode, setRoutingMode] = useState<RoutingMode>(
    settings.routingMode ?? "full"
  );
  const [cacheSize, setCacheSize]     = useState(embeddingCacheSize());

  // Sync draft when settings load from disk
  useEffect(() => {
    setOllamaUrl(settings.ollamaBaseUrl);
    setEmbedModel(settings.embedModel ?? DEFAULT_EMBED_MODEL);
    setRoutingMode(settings.routingMode ?? "full");
  }, [settings]);

  // Refresh cache size every time panel opens
  useEffect(() => {
    if (open) setCacheSize(embeddingCacheSize());
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Folder picker via Tauri dialog
  const pickAgentsDir = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected) {
        await updateSettings({ agentsDir: selected });
      }
    } catch {
      // Dialog cancelled or Tauri context unavailable (dev mode)
    }
  }, [updateSettings]);

  // Commit text field changes on blur
  const commitUrl = useCallback(
    () => updateSettings({ ollamaBaseUrl: ollamaUrl }),
    [ollamaUrl, updateSettings]
  );
  const commitEmbedModel = useCallback(
    () => updateSettings({ embedModel }),
    [embedModel, updateSettings]
  );

  const handleRoutingMode = useCallback(
    (mode: RoutingMode) => {
      setRoutingMode(mode);
      updateSettings({ routingMode: mode });
    },
    [updateSettings]
  );

  const handleClearCache = useCallback(() => {
    clearEmbeddingCache();
    setCacheSize(0);
  }, []);

  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`${styles.backdrop} ${open ? styles.backdropVisible : ""}`}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className={`${styles.panel} ${open ? styles.panelOpen : ""}`}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className={styles.body}>

          {/* ── Section: LLM ────────────────────────────────────────────── */}
          <SectionHeader
            title="LLM"
            description="Configure the local model used when no agent-level model is set."
          />

          <Field
            label="Default model"
            htmlFor="s-default-model"
            hint="Used by agents that don't specify a model in their persona.md."
          >
            <select
              id="s-default-model"
              className={styles.select}
              value={settings.defaultModel}
              onChange={(e) => updateSettings({ defaultModel: e.target.value })}
            >
              {localModels.length === 0 && (
                <option value="">— No models installed —</option>
              )}
              {localModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Ollama base URL"
            htmlFor="s-ollama-url"
            hint="Change if Ollama runs on a non-default port or remote host."
          >
            <TextInput
              id="s-ollama-url"
              value={ollamaUrl}
              onChange={setOllamaUrl}
              onBlur={commitUrl}
              placeholder="http://localhost:11434"
              monospace
            />
          </Field>

          <div className={styles.divider} />

          {/* ── Section: Agents ─────────────────────────────────────────── */}
          <SectionHeader
            title="Agents"
            description="The directory that AgentForge scans for agent subfolders."
          />

          <Field
            label="Agents directory"
            htmlFor="s-agents-dir"
            hint="Each subfolder with a persona.md becomes an agent."
          >
            <div className={styles.pathRow}>
              <input
                id="s-agents-dir"
                className={`${styles.input} ${styles.mono} ${styles.pathInput}`}
                value={settings.agentsDir}
                readOnly
                placeholder="Not set — click Browse to choose a folder"
              />
              <button className={styles.browseBtn} onClick={pickAgentsDir}>
                Browse
              </button>
            </div>
          </Field>

          <div className={styles.divider} />

          {/* ── Section: Routing ────────────────────────────────────────── */}
          <SectionHeader
            title="Routing"
            description="How AgentForge selects the best agent for a prompt."
          />

          <Field label="Routing mode">
            <RadioGroup<RoutingMode>
              name="routing-mode"
              value={routingMode}
              onChange={handleRoutingMode}
              options={[
                {
                  value: "full",
                  label: "Full (recommended)",
                  description:
                    "Rules → Semantic embeddings → LLM fallback. Most accurate.",
                },
                {
                  value: "no-semantic",
                  label: "Rules + LLM",
                  description:
                    "Skips embedding step. Faster if nomic-embed-text is not installed.",
                },
                {
                  value: "rules-only",
                  label: "Rules only",
                  description:
                    "Keyword triggers only. Instant, no API calls, least flexible.",
                },
              ]}
            />
          </Field>

          <Field
            label="Embedding model"
            htmlFor="s-embed-model"
            hint={`Pull once with: ollama pull ${embedModel}`}
          >
            <TextInput
              id="s-embed-model"
              value={embedModel}
              onChange={setEmbedModel}
              onBlur={commitEmbedModel}
              placeholder={DEFAULT_EMBED_MODEL}
              monospace
            />
          </Field>

          <div className={styles.divider} />

          {/* ── Section: Appearance ───────────────────────────────────────── */}
          <SectionHeader title="Appearance" />

          <Field label="Theme">
            <div className={styles.themeRow}>
              {(["dark", "light", "system"] as const).map((t) => (
                <button
                  key={t}
                  className={`${styles.themeBtn} ${
                    settings.theme === t ? styles.themeBtnActive : ""
                  }`}
                  onClick={() => updateSettings({ theme: t })}
                >
                  {t === "dark" ? "Dark" : t === "light" ? "Light" : "System"}
                </button>
              ))}
            </div>
          </Field>

          <div className={styles.divider} />

          {/* ── Section: Diagnostics ──────────────────────────────────────── */}
          <SectionHeader
            title="Diagnostics"
            description="Embedding vectors are cached in memory for faster routing."
          />

          <Field label="Embedding cache">
            <div className={styles.diagRow}>
              <span className={styles.diagValue}>
                {cacheSize} vector{cacheSize !== 1 ? "s" : ""} cached
              </span>
              <button
                className={styles.clearBtn}
                onClick={handleClearCache}
                disabled={cacheSize === 0}
              >
                Clear cache
              </button>
            </div>
          </Field>

          <div className={styles.divider} />

          {/* Version */}
          <p className={styles.version}>AgentForge v0.1.0</p>

        </div>
      </div>
    </>
  );
}
