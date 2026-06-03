/**
 * FrontmatterPanel — structured editor for YAML frontmatter fields.
 *
 * Parses the YAML block between the first pair of `---` delimiters in
 * persona.md and exposes all known fields as typed inputs. On change it
 * writes the updated YAML back into the persona content string via the
 * editor store, so the CodeMirror view stays in sync.
 *
 * Known fields rendered as specialised controls:
 *   name, description  → text inputs
 *   model              → text input (autocompleted from loaded models)
 *   triggers           → tag list (comma-separated input)
 *   next_agents        → tag list (comma-separated input)
 *   context_mode       → select (full | summary | none)
 *   temperature        → range 0.0–2.0 step 0.1
 *   max_tokens         → number input
 *
 * Unknown fields fall through to a generic key→value text input.
 */
import { useMemo } from "react";
import { useEditorStore } from "./useEditorStore";
import { useAppStore } from "@/store/useAppStore";
import styles from "./FrontmatterPanel.module.css";

type FM = Record<string, unknown>;

/** Extract YAML text between first `---` pair. */
function parseFrontmatter(src: string): { fm: FM; body: string } {
  const match = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) return { fm: {}, body: src };
  try {
    // Minimal YAML parser for flat key: value and key: [list] structures.
    const fm: FM = {};
    const lines = match[1].split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const kv = line.match(/^([\w_-]+):\s*(.*)/);
      if (!kv) { i++; continue; }
      const key = kv[1];
      const rawVal = kv[2].trim();
      // Inline list: [a, b, c]
      if (rawVal.startsWith("[")) {
        fm[key] = rawVal
          .replace(/[[\]]/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
        i++;
        continue;
      }
      // Multiline list:
      if (rawVal === "") {
        const items: string[] = [];
        i++;
        while (i < lines.length && /^\s*-\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*-\s*/, "").replace(/^"|"$/g, "").trim());
          i++;
        }
        if (items.length) { fm[key] = items; continue; }
        fm[key] = "";
        continue;
      }
      fm[key] = rawVal.replace(/^"|"$/g, "");
      i++;
    }
    return { fm, body: match[2] };
  } catch {
    return { fm: {}, body: src };
  }
}

/** Serialise an FM object back into a `---\n...\n---\n` block. */
function serialiseFrontmatter(fm: FM, body: string): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        v.forEach((item) => lines.push(`  - ${item}`));
      }
    } else if (typeof v === "number") {
      lines.push(`${k}: ${v}`);
    } else {
      const s = String(v ?? "");
      lines.push(`${k}: ${s.includes(":") ? `"${s}"` : s}`);
    }
  }
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export function FrontmatterPanel() {
  const { files, setContent } = useEditorStore();
  const { localModels } = useAppStore();
  const personaFile = files.persona;

  const { fm, body } = useMemo(
    () => parseFrontmatter(personaFile?.content ?? ""),
    [personaFile?.content]
  );

  if (!personaFile) return null;

  const update = (patch: Partial<FM>) => {
    const next = { ...fm, ...patch };
    setContent("persona", serialiseFrontmatter(next, body));
  };

  const str = (key: string) => String(fm[key] ?? "");
  const arr = (key: string): string[] =>
    Array.isArray(fm[key]) ? (fm[key] as string[]) : [];
  const num = (key: string, fallback: number) =>
    typeof fm[key] === "number" ? (fm[key] as number) : fallback;

  const knownKeys = new Set([
    "name", "description", "model", "triggers",
    "next_agents", "context_mode", "temperature", "max_tokens",
  ]);
  const unknownKeys = Object.keys(fm).filter((k) => !knownKeys.has(k));

  return (
    <aside className={styles.panel}>
      <p className={styles.heading}>Frontmatter</p>

      <Field label="name">
        <input
          className={styles.input}
          value={str("name")}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Agent name"
        />
      </Field>

      <Field label="description">
        <textarea
          className={styles.textarea}
          value={str("description")}
          onChange={(e) => update({ description: e.target.value })}
          rows={2}
          placeholder="Short description"
        />
      </Field>

      <Field label="model">
        <input
          className={styles.input}
          list="fm-models"
          value={str("model")}
          onChange={(e) => update({ model: e.target.value })}
          placeholder="e.g. llama3:8b"
        />
        <datalist id="fm-models">
          {localModels.map((m) => (
            <option key={m.name} value={m.name} />
          ))}
        </datalist>
      </Field>

      <Field label="context_mode">
        <select
          className={styles.select}
          value={str("context_mode") || "summary"}
          onChange={(e) => update({ context_mode: e.target.value })}
        >
          <option value="full">full</option>
          <option value="summary">summary</option>
          <option value="none">none</option>
        </select>
      </Field>

      <Field label="temperature">
        <div className={styles.rangeRow}>
          <input
            type="range" min={0} max={2} step={0.05}
            className={styles.range}
            value={num("temperature", 0.7)}
            onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
          />
          <span className={styles.rangeVal}>{num("temperature", 0.7).toFixed(2)}</span>
        </div>
      </Field>

      <Field label="max_tokens">
        <input
          type="number" min={256} max={32768} step={256}
          className={styles.input}
          value={num("max_tokens", 2048)}
          onChange={(e) => update({ max_tokens: parseInt(e.target.value, 10) })}
        />
      </Field>

      <Field label="triggers">
        <TagInput
          tags={arr("triggers")}
          onChange={(v) => update({ triggers: v })}
          placeholder="Add trigger keyword…"
        />
      </Field>

      <Field label="next_agents">
        <TagInput
          tags={arr("next_agents")}
          onChange={(v) => update({ next_agents: v })}
          placeholder="Add agent id…"
        />
      </Field>

      {/* Unknown fields */}
      {unknownKeys.map((k) => (
        <Field key={k} label={k}>
          <input
            className={styles.input}
            value={String(fm[k] ?? "")}
            onChange={(e) => update({ [k]: e.target.value })}
          />
        </Field>
      ))}
    </aside>
  );
}

// ── Small sub-components ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      {children}
    </div>
  );
}

function TagInput({
  tags, onChange, placeholder,
}: {
  tags: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const remove = (i: number) => onChange(tags.filter((_, idx) => idx !== i));
  const add = (raw: string) => {
    const vals = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length) onChange([...tags, ...vals]);
  };

  return (
    <div className={styles.tagWrap}>
      {tags.map((t, i) => (
        <span key={i} className={styles.tag}>
          {t}
          <button
            className={styles.tagRemove}
            onClick={() => remove(i)}
            aria-label={`Remove ${t}`}
          >×</button>
        </span>
      ))}
      <input
        className={styles.tagInput}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = "";
          }
        }}
        onBlur={(e) => {
          if (e.target.value) {
            add(e.target.value);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}
