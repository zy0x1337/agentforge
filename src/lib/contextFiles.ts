/**
 * contextFiles.ts — helpers for attaching file/folder context to prompts
 * and parsing agent-proposed file writes.
 *
 * Write-file protocol
 * ───────────────────
 * Agents signal a file modification by wrapping the new content in:
 *
 *   <write_file path="relative/or/absolute/path.ts">
 *   …new file content…
 *   </write_file>
 *
 * The ChatPanel parses this after each run and routes the ops through
 * FileChangeReview before any disk write occurs.
 */

import { readTextFile, readDir } from "@tauri-apps/plugin-fs";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
  "css", "scss", "html", "json", "yaml", "yml",
  "md", "txt", "toml", "sh", "bash", "zsh",
  "env", "gitignore", "dockerfile", "makefile", "sql",
]);

/** Skip files larger than this when reading context. */
const MAX_FILE_BYTES  = 80_000;
/** Skip folders with more than this many eligible files. */
const MAX_FOLDER_FILES = 30;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttachedFile {
  /** Absolute or relative path as returned by the dialog. */
  path: string;
  /** Basename shown in chips. */
  name: string;
  content: string;
}

export interface FileWriteOp {
  path: string;
  newContent: string;
}

// ── File reading ──────────────────────────────────────────────────────────────

function isTextFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

export async function readFileForContext(
  path: string,
): Promise<AttachedFile | null> {
  try {
    const content = await readTextFile(path);
    if (content.length > MAX_FILE_BYTES) return null;
    const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
    return { path, name, content };
  } catch {
    return null;
  }
}

export async function readFolderForContext(folderPath: string): Promise<{
  files: AttachedFile[];
  skipped: number;
}> {
  const entries = await readDir(folderPath);
  const files: AttachedFile[] = [];
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.name || entry.isDirectory) continue;
    if (!isTextFile(entry.name)) { skipped++; continue; }
    if (files.length >= MAX_FOLDER_FILES) { skipped++; continue; }

    const filePath = `${folderPath}/${entry.name}`;
    const file = await readFileForContext(filePath);
    if (file) files.push(file);
    else skipped++;
  }

  return { files, skipped };
}

// ── Prompt injection ──────────────────────────────────────────────────────────

/**
 * Build the context block prepended to the user prompt.
 * Folders are listed even when empty so the agent knows where to write files.
 */
export function formatContextBlock(
  files: AttachedFile[],
  folders: string[] = [],
): string {
  if (files.length === 0 && folders.length === 0) return "";

  const parts: string[] = [];

  if (folders.length > 0) {
    const list = folders.map((f) => `  - ${f}`).join("\n");
    parts.push(
      `Working directories (use these absolute paths when writing files):\n${list}`,
    );
  }

  if (files.length > 0) {
    const blocks = files
      .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
      .join("\n");
    parts.push(blocks);
  }

  const label =
    [
      files.length > 0 ? `${files.length} file${files.length !== 1 ? "s" : ""}` : "",
      folders.length > 0 ? `${folders.length} folder${folders.length !== 1 ? "s" : ""}` : "",
    ]
      .filter(Boolean)
      .join(", ");

  return `[Attached context — ${label}]\n${parts.join("\n\n")}\n[End context]\n\n`;
}

// ── Write-file parser ─────────────────────────────────────────────────────────

const WRITE_FILE_RE =
  /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g;

export function parseWriteFileBlocks(output: string): FileWriteOp[] {
  const ops: FileWriteOp[] = [];
  WRITE_FILE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WRITE_FILE_RE.exec(output)) !== null) {
    ops.push({
      path: match[1],
      newContent: match[2].replace(/^\n/, ""),
    });
  }
  return ops;
}

// ── Line-level diff ───────────────────────────────────────────────────────────

export type DiffLineType = "added" | "removed" | "unchanged";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldNum?: number;
  newNum?: number;
}

/**
 * Myers-style line diff via LCS backtracking.
 * Falls back to "all added" for files > 500 lines.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0) {
    return newLines.map((l, i) => ({ type: "added", content: l, newNum: i + 1 }));
  }

  if (n > 500 || m > 500) {
    return newLines.map((l, i) => ({ type: "added", content: l, newNum: i + 1 }));
  }

  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = n, j = m;
  let oldNum = n, newNum = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "unchanged", content: oldLines[i - 1], oldNum, newNum });
      i--; j--; oldNum--; newNum--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", content: newLines[j - 1], newNum });
      j--; newNum--;
    } else {
      result.unshift({ type: "removed", content: oldLines[i - 1], oldNum });
      i--; oldNum--;
    }
  }
  return result;
}

/**
 * Collapse long unchanged runs to ±3 context lines around changes.
 */
export function collapseDiff(lines: DiffLine[], context = 3): DiffLine[] {
  const changed = new Set<number>();
  lines.forEach((l, i) => { if (l.type !== "unchanged") changed.add(i); });

  const visible = new Set<number>();
  changed.forEach((ci) => {
    for (let d = -context; d <= context; d++) {
      const idx = ci + d;
      if (idx >= 0 && idx < lines.length) visible.add(idx);
    }
  });

  const result: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (visible.has(i)) {
      if (skipped > 0) {
        result.push({ type: "unchanged", content: `… ${skipped} unchanged lines …` });
        skipped = 0;
      }
      result.push(l);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) {
    result.push({ type: "unchanged", content: `… ${skipped} unchanged lines …` });
  }
  return result;
}
