/**
 * agentFs.ts — reads agent folders from disk via Tauri FS plugin.
 *
 * An agent folder must contain persona.md (required).
 * Optional files: prompt.md, workflow.md.
 *
 * workflow.md is now read as raw string and stored on the Agent object so
 * the workflow runner can decide whether to use static or dynamic mode.
 */

import { readDir, readTextFile, mkdir, writeTextFile, remove } from "@tauri-apps/plugin-fs";
import matter from "gray-matter";
import type { Agent, AgentFrontmatter } from "@/types";

const REQUIRED_FILE = "persona.md";

/**
 * Lightweight agent descriptor used by the workflow/parallel runners to resolve
 * per-agent execution settings (model, token budget, context mode) without
 * passing the full Agent object around.
 */
export interface AgentMeta {
  id: string;
  model?: string;
  maxTokens?: number;
  contextMode?: "full" | "summary" | "none";
  /** Sequential successor agent ids (from frontmatter `next_agents`). */
  nextAgents?: string[];
}

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
  // Normalize: strip trailing slashes so path joins are always clean
  const base = agentsDir.replace(/[\\/]+$/, "");

  const entries = await readDir(base);
  const agents: Agent[] = [];

  for (const entry of entries) {
    if (!entry.name) continue;              // null name — skip (defensive)
    if (entry.isDirectory === false) continue;

    const dir = `${base}/${entry.name}`;
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
  await writeTextFile(`${agentPath}/${filename}`, content);
}

/**
 * Create a new agent folder under agentsDir with a scaffolded persona.md.
 * The folder name is derived from a slugified version of `name`.
 * Returns the absolute path of the created agent folder.
 */
export type AgentTemplate = "blank" | "coder" | "analyst" | "router";

const TEMPLATES: Record<AgentTemplate, (name: string) => string> = {
  blank: (name) => [
    "---",
    `name: ${name}`,
    "description: ",
    "model: ",
    "temperature: 0.7",
    "triggers: []",
    "next_agents: []",
    "context_mode: summary",
    "---",
    "",
    `You are ${name}.`,
    "",
  ].join("\n"),

  coder: (name) => [
    "---",
    `name: ${name}`,
    "description: Implements code changes based on requirements",
    "model: qwen2.5-coder:7b",
    "temperature: 0.2",
    "triggers:",
    "  - code",
    "  - implement",
    "  - write",
    "  - fix",
    "  - refactor",
    "next_agents: []",
    "context_mode: full",
    "max_tokens: 4096",
    "---",
    "",
    `You are ${name}, an expert software engineer.`,
    "You write clean, correct, well-structured code.",
    "When asked to modify files, use the <write_file path=\"...\"> protocol.",
    "",
  ].join("\n"),

  analyst: (name) => [
    "---",
    `name: ${name}`,
    "description: Analyzes and summarizes information",
    "model: llama3.1:8b",
    "temperature: 0.5",
    "triggers:",
    "  - analyze",
    "  - summarize",
    "  - explain",
    "  - review",
    "next_agents: []",
    "context_mode: full",
    "max_tokens: 2048",
    "---",
    "",
    `You are ${name}, a thorough and precise analyst.`,
    "You provide clear, structured analysis and actionable insights.",
    "",
  ].join("\n"),

  router: (name) => [
    "---",
    `name: ${name}`,
    "description: Routes requests to the most appropriate specialist agent",
    "model: llama3.2:3b",
    "temperature: 0.1",
    "triggers: []",
    "next_agents: []",
    "context_mode: none",
    "max_tokens: 256",
    "---",
    "",
    `You are ${name}, a routing agent.`,
    "Your sole job is to analyze the user's request and decide which specialist should handle it.",
    "Respond with only the agent id, nothing else.",
    "",
  ].join("\n"),
};

export async function createAgent(
  agentsDir: string,
  name: string,
  template: AgentTemplate = "blank"
): Promise<string> {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!id) throw new Error("Invalid agent name");

  const dir = `${agentsDir}/${id}`;
  await mkdir(dir, { recursive: true });

  await writeTextFile(`${dir}/${REQUIRED_FILE}`, TEMPLATES[template](name));
  return dir;
}

/** Permanently delete an agent folder and all its contents. */
export async function deleteAgent(agentPath: string): Promise<void> {
  await remove(agentPath, { recursive: true });
}
