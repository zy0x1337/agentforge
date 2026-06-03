/**
 * useEditorStore — per-session editor state.
 *
 * Tracks open file contents, dirty flags, the active tab, and exposes
 * save() which calls Tauri fs.writeTextFile.
 */
import { create } from "zustand";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";

export type EditorTab = "persona" | "prompt" | "workflow" | "tools";

const TAB_FILENAME: Record<EditorTab, string> = {
  persona:  "persona.md",
  prompt:   "prompt.md",
  workflow: "workflow.md",
  tools:    "tools.md",
};

interface EditorFile {
  content: string;
  originalContent: string;
  exists: boolean;
}

interface EditorState {
  agentDir: string | null;
  files: Record<EditorTab, EditorFile | null>;
  activeTab: EditorTab;
  saving: boolean;
  lastSaved: number;

  loadAgent: (agentDir: string) => Promise<void>;
  setContent: (tab: EditorTab, value: string) => void;
  setActiveTab: (tab: EditorTab) => void;
  save: () => Promise<void>;
  saveTab: (tab: EditorTab) => Promise<void>;
  revert: (tab: EditorTab) => void;

  isDirty: (tab: EditorTab) => boolean;
  anyDirty: () => boolean;
}

async function tryRead(path: string): Promise<{ content: string; exists: boolean }> {
  try {
    const content = await readTextFile(path);
    return { content, exists: true };
  } catch {
    return { content: "", exists: false };
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  agentDir: null,
  files: { persona: null, prompt: null, workflow: null, tools: null },
  activeTab: "persona",
  saving: false,
  lastSaved: 0,

  loadAgent: async (agentDir) => {
    const tabs: EditorTab[] = ["persona", "prompt", "workflow", "tools"];
    const entries = await Promise.all(
      tabs.map(async (tab) => {
        const path = `${agentDir}/${TAB_FILENAME[tab]}`;
        const { content, exists } = await tryRead(path);
        return [tab, { content, originalContent: content, exists }] as const;
      })
    );
    set({
      agentDir,
      activeTab: "persona",
      files: Object.fromEntries(entries) as Record<EditorTab, EditorFile>,
    });
  },

  setContent: (tab, value) =>
    set((s) => ({
      files: {
        ...s.files,
        [tab]: s.files[tab]
          ? { ...s.files[tab]!, content: value }
          : { content: value, originalContent: "", exists: false },
      },
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  save: async () => {
    const { agentDir, files, saving } = get();
    if (!agentDir || saving) return;
    set({ saving: true });
    try {
      const tabs: EditorTab[] = ["persona", "prompt", "workflow", "tools"];
      await Promise.all(
        tabs
          .filter((t) => {
            const f = files[t];
            return f && f.content !== f.originalContent;
          })
          .map((t) =>
            writeTextFile(`${agentDir}/${TAB_FILENAME[t]}`, files[t]!.content)
          )
      );
      set((s) => ({
        saving: false,
        lastSaved: Date.now(),
        files: Object.fromEntries(
          Object.entries(s.files).map(([k, v]) => [
            k,
            v ? { ...v, originalContent: v.content } : null,
          ])
        ) as Record<EditorTab, EditorFile | null>,
      }));
    } catch (err) {
      set({ saving: false });
      console.error("[AgentEditor] save failed", err);
    }
  },

  saveTab: async (tab) => {
    const { agentDir, files } = get();
    if (!agentDir) return;
    const f = files[tab];
    if (!f) return;
    await writeTextFile(`${agentDir}/${TAB_FILENAME[tab]}`, f.content);
    set((s) => ({
      lastSaved: Date.now(),
      files: {
        ...s.files,
        [tab]: { ...s.files[tab]!, originalContent: f.content },
      },
    }));
  },

  revert: (tab) =>
    set((s) => ({
      files: {
        ...s.files,
        [tab]: s.files[tab]
          ? { ...s.files[tab]!, content: s.files[tab]!.originalContent }
          : null,
      },
    })),

  isDirty: (tab) => {
    const f = get().files[tab];
    return !!f && f.content !== f.originalContent;
  },

  anyDirty: () => {
    const { files } = get();
    return (Object.values(files) as (EditorFile | null)[]).some(
      (f) => f && f.content !== f.originalContent
    );
  },
}));
