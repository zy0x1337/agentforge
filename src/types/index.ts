// ── Agent & Workflow types ────────────────────────────────────────────────────

export interface AgentFrontmatter {
  name: string;
  description: string;
  model?: string;
  temperature?: number;
  triggers?: string[];
  next_agents?: string[];
  context_mode?: "full" | "summary" | "none";
  max_tokens?: number;
  tools?: string[];
  tags?: string[];
}

export interface Agent {
  id: string;
  path: string;
  frontmatter: AgentFrontmatter;
  persona: string;
  prompt?: string;
  /** Raw contents of workflow.md — present only if the file exists. */
  workflow?: string;
}

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  agentId?: string;
  timestamp: number;
}

export interface WorkflowStep {
  agentId: string;
  input: string;
  output?: string;
  status: "pending" | "running" | "done" | "error" | "aborted";
  contextMode: "full" | "summary" | "none";
  /** True when this step was skipped due to a condition evaluating to false. */
  skipped?: boolean;
}

export interface WorkflowRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  initialPrompt: string;
  steps: WorkflowStep[];
  status: "running" | "done" | "error" | "aborted";
  /** "static" when driven by workflow.md, "dynamic" when driven by the router. */
  executionMode?: "static" | "dynamic";
}

// ── Ollama types ──────────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ── App state ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  agentsDir: string;
  defaultModel: string;
  ollamaBaseUrl: string;
  theme: "light" | "dark" | "system";
}
