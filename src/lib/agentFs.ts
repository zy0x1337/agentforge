import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";
import matter from "gray-matter";
import type { Agent, AgentFrontmatter } from "@/types";

const MD_FALLBACK: AgentFrontmatter = {
  name: "Unnamed Agent",
  description: "",
  context_mode: "summary",
};

async function readMd(
  path: string
): Promise<{ frontmatter: Partial<AgentFrontmatter>; body: string }> {
  try {
    const raw = await readTextFile(path);
    const { data, content } = matter(raw);
    return { frontmatter: data as Partial<AgentFrontmatter>, body: content.trim() };
  } catch {
    return { frontmatter: {}, body: "" };
  }
}

/** Load all agents from a root agents/ directory */
export async function loadAgents(agentsDir: string): Promise<Agent[]> {
  const entries = await readDir(agentsDir);
  const agents: Agent[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;

    const agentPath = `${agentsDir}/${entry.name}`;
    const personaPath = `${agentPath}/persona.md`;

    if (!(await exists(personaPath))) continue;

    const { frontmatter: fm, body: persona } = await readMd(personaPath);
    const { body: prompt } = await readMd(`${agentPath}/prompt.md`);
    const { body: workflow } = await readMd(`${agentPath}/workflow.md`);

    agents.push({
      id: entry.name,
      path: agentPath,
      frontmatter: { ...MD_FALLBACK, ...fm, name: fm.name ?? entry.name },
      persona,
      prompt: prompt || undefined,
      workflow: workflow || undefined,
    });
  }

  return agents;
}

/** Save edits to a .md file inside an agent folder */
export async function saveAgentFile(
  agentPath: string,
  file: "persona" | "prompt" | "workflow" | "context",
  content: string
): Promise<void> {
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(`${agentPath}/${file}.md`, content);
}

/** Create a new agent folder with a minimal persona.md */
export async function createAgent(agentsDir: string, name: string): Promise<void> {
  const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const dir = `${agentsDir}/${slug}`;
  await mkdir(dir, { recursive: true });
  await writeTextFile(
    `${dir}/persona.md`,
    `---\nname: ${name}\ndescription: ""\ntriggers: []\nnext_agents: []\nmodel: ""\ncontext_mode: summary\n---\n\nYou are ${name}. Describe the role here.\n`
  );
}
