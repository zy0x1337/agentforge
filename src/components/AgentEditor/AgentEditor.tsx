/**
 * AgentEditor — split-pane editor for an agent's .md files.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  [persona.md ●] [prompt.md] [workflow.md] [tools.md]  [S] [⟳] │  ← tab bar
 *   ├─────────────────────────────────┬──────────────────────────────┤
 *   │                                 │                              │
 *   │   CodeMirror 6 (markdown+yaml)  │   Live MD preview  │  FM →  │
 *   │                                 │   (marked + DOMPurify)       │
 *   │                                 │                              │
 *   └─────────────────────────────────┴──────────────────────────────┘
 *                   editor pane                 preview pane   FM panel
 *
 * CodeMirror extensions used:
 *   - markdown() with yaml() for frontmatter
 *   - keymap: Ctrl/Cmd+S → save active tab
 *   - oneDark / vscode theme (dark/light via data-theme)
 *
 * The FrontmatterPanel is shown only for persona.md (the canonical
 * metadata file). For other tabs it is hidden.
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState as CMState } from "@codemirror/state";
import { defaultKeymap, historyKeymap, history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useEditorStore, type EditorTab } from "./useEditorStore";
import { FrontmatterPanel } from "./FrontmatterPanel";
import styles from "./AgentEditor.module.css";

const TABS: { id: EditorTab; label: string }[] = [
  { id: "persona",  label: "persona.md" },
  { id: "prompt",   label: "prompt.md" },
  { id: "workflow", label: "workflow.md" },
  { id: "tools",    label: "tools.md" },
];

function isDarkTheme() {
  return document.documentElement.getAttribute("data-theme") !== "light";
}

function buildExtensions(onChange: (v: string) => void, onSave: () => void) {
  return [
    history(),
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    markdown(),
    yaml(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    isDarkTheme() ? oneDark : [],
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      {
        key: "Mod-s",
        run: () => { onSave(); return true; },
      },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "var(--text-xs)",
        fontFamily: "var(--font-mono)",
        background: "var(--surface)",
      },
      ".cm-content": { paddingBlock: "var(--space-4)" },
      ".cm-line": { paddingInline: "var(--space-4)" },
      ".cm-scroller": { overflow: "auto" },
      "&.cm-focused": { outline: "none" },
    }),
  ];
}

export function AgentEditor() {
  const {
    files,
    activeTab,
    setActiveTab,
    setContent,
    save,
    saveTab,
    revert,
    isDirty,
    anyDirty,
    saving,
  } = useEditorStore();

  const [showPreview, setShowPreview] = useState(true);
  const [showFm, setShowFm]           = useState(true);

  const editorRef = useRef<HTMLDivElement>(null);
  const cmView = useRef<EditorView | null>(null);
  const currentTab = useRef<EditorTab>(activeTab);

  const handleSave = useCallback(() => saveTab(activeTab), [activeTab, saveTab]);

  // (Re-)create CodeMirror when activeTab changes or component mounts
  useEffect(() => {
    if (!editorRef.current) return;
    currentTab.current = activeTab;

    // Destroy previous instance
    cmView.current?.destroy();

    const file = files[activeTab];
    const initialContent = file?.content ?? "";

    const state = CMState.create({
      doc: initialContent,
      extensions: buildExtensions(
        (v) => setContent(activeTab, v),
        handleSave
      ),
    });

    cmView.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    return () => {
      cmView.current?.destroy();
      cmView.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Keep CM in sync when content changes externally (e.g. revert, FrontmatterPanel edits)
  useEffect(() => {
    const view = cmView.current;
    if (!view) return;
    const file = files[activeTab];
    const incoming = file?.content ?? "";
    const current = view.state.doc.toString();
    if (incoming !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: incoming },
      });
    }
  }, [files, activeTab]);

  const activeFile = files[activeTab];
  const previewHtml = DOMPurify.sanitize(
    marked.parse(activeFile?.content ?? "") as string
  );

  return (
    <div className={styles.root}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {TABS.map((tab) => {
            const dirty = isDirty(tab.id);
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`${styles.tab} ${active ? styles.tabActive : ""}`}
                onClick={() => setActiveTab(tab.id)}
                title={dirty ? `${tab.label} (unsaved changes)` : tab.label}
              >
                {tab.label}
                {dirty && <span className={styles.dirty} aria-label="unsaved">●</span>}
              </button>
            );
          })}
        </div>
        <div className={styles.tabActions}>
          {/* Preview toggle */}
          <button
            className={styles.actionBtn}
            onClick={() => setShowPreview((v) => !v)}
            title={showPreview ? "Hide preview" : "Show preview"}
            style={{ opacity: showPreview ? 1 : 0.4 }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
              <circle cx="8" cy="8" r="2" />
              {!showPreview && <path d="M2 2l12 12" />}
            </svg>
          </button>

          {/* Frontmatter panel toggle — only relevant on persona tab */}
          {activeTab === "persona" && (
            <button
              className={styles.actionBtn}
              onClick={() => setShowFm((v) => !v)}
              title={showFm ? "Hide frontmatter panel" : "Show frontmatter panel"}
              style={{ opacity: showFm ? 1 : 0.4, fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.04em" }}
            >
              FM
            </button>
          )}

          <button
            className={styles.actionBtn}
            onClick={() => save()}
            disabled={!anyDirty() || saving}
            title={saving ? "Saving…" : "Save all (Ctrl+S)"}
          >
            {saving ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 2a6 6 0 1 0 6 6" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite"/></path>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M13 11v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6l3 3v5z" />
                <path d="M9 13V9H5v4" />
                <path d="M5 3v3h5" />
              </svg>
            )}
            {anyDirty() && !saving && <span className={styles.saveLabel}>Save all</span>}
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => revert(activeTab)}
            disabled={!isDirty(activeTab)}
            title="Revert to saved"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 8a5 5 0 1 0 1-3" />
              <path d="M3 3v3h3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main area: editor | preview | frontmatter */}
      <div className={styles.body}>
        {/* CodeMirror pane */}
        <div className={styles.editorPane} ref={editorRef} />

        {/* Preview pane */}
        {showPreview && (
          <div className={styles.previewPane}>
            <div
              className={styles.preview}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}

        {/* Frontmatter panel — persona tab only */}
        {activeTab === "persona" && showFm && <FrontmatterPanel />}
      </div>
    </div>
  );
}
