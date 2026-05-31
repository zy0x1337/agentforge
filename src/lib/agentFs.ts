/**
 * agentFs.ts — reads agent folders from disk via Tauri FS plugin.
 *
 * An agent folder must contain persona.md (required).
 * Optional files: prompt.md, workflow.md.
 *
 * workflow.md is now read as raw string and stored on the Agent object so
 * the workflow runner can decide whether to use static or dynamic mode.
 */

import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import matter from "gray-matter";
import type { Agent, AgentFrontmatter } from "@/types";

const REQUIRED_FILE = "persona.md";
const OPTIONAL_FILES = ["prompt.md", "workflow.md"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function tryReadFile(
  dir: string,
  filename: string
): Promise<string | null> {
  try {
    return await readTextFile(`${dir}/${filename}`);
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string): {
  frontmatter: AgentFrontmatter;
  body: string;
} {
  const parsed = matter(raw);
  const fm = parsed.data as Partial<AgentFrontmatter>;

  // Ensure required fields have sane defaults so the app never crashes on
  // partially authored agents.
  const frontmatter: AgentFrontmatter = {
    name: typeof fm.name === "string" ? fm.name : "Unnamed Agent",
    description:
      typeof fm.description === "string" ? fm.description : "",
    model: typeof fm.model === "string" ? fm.model : undefined,
    temperature:
      typeof fm.temperature === "number" ? fm.temperature : undefined,
    triggers: Array.isArray(fm.triggers) ? fm.triggers : [],
    next_agents: Array.isArray(fm.next_agents) ? fm.next_agents : [],
    context_mode:
      fm.context_mode === "full" ||
      fm.context_mode === "summary" ||
      fm.context_mode === "none"
        ? fm.context_mode
        : "summary",
    max_tokens:
      typeof fm.max_tokens === "number" ? fm.max_tokens : undefined,
    tools: Array.isArray(fm.tools) ? fm.tools : [],
    tags: Array.isArray(fm.tags) ? fm.tags : [],
  };

  return { frontmatter, body: parsed.content.trim() };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Scan agentsDir and return all valid agents found.
 * A folder is a valid agent if it contains persona.md.
 * Folders missing persona.md are silently skipped.
 */
export async function loadAgents(agentsDir: string): Promise<Agent[]> {
  const entries = await readDir(agentsDir);
  const agents: Agent[] = [];

  for (const entry of entries) {
    if (entry.isDirectory === false) continue;

    const dir = `${agentsDir}/${entry.name}`;
    const personaRaw = await tryReadFile(dir, REQUIRED_FILE);

    if (!personaRaw) {
      // Not an agent folder — skip silently
      continue;
    }

    const { frontmatter, body: persona } = parseFrontmatter(personaRaw);

    // prompt.md — strip frontmatter, keep body
    const promptRaw = await tryReadFile(dir, "prompt.md");
    const prompt = promptRaw ? matter(promptRaw).content.trim() : undefined;

    // workflow.md — keep full raw string for workflowParser
    const workflow = await tryReadFile(dir, "workflow.md");

    agents.push({
      id: entry.name,
      path: dir,
      frontmatter,
      persona,
      prompt: prompt || undefined,
      workflow: workflow || undefined,
    });
  }

  return agents;
}

/**
 * Write a single file inside an agent's folder.
 * Used by Agent Explorer's inline editor.
 */
export async function saveAgentFile(
  agentPath: string,
  filename: string,
  content: string
): Promise<void> {
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(`${agentPath}/${filename}`, content);
}
