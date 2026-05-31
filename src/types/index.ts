// ── Agent & Workflow types ────────────────────────────────────────────────────

export interface AgentFrontmatter {
  name: string;
  description: string;
  model?: string;                      // e.g. "qwen2.5-coder:7b" — falls back to app default
  temperature?: number;                // 0.0–1.0
  triggers?: string[];                 // keyword hints for rule-based routing
  next_agents?: string[];              // explicit next agents (rule-based)
  context_mode?: "full" | "summary" | "none"; // how context is passed forward
  max_tokens?: number;
  tools?: string[];                    // future: MCP tool names
  tags?: string[];
}

export interface Agent {
  id: string;               // folder name (slug)
  path: string;             // absolute path to agent folder
  frontmatter: AgentFrontmatter;
  persona: string;          // body of persona.md
  prompt?: string;          // body of prompt.md (optional template)
  workflow?: string;        // body of workflow.md (optional chain definition)
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
  status: "pending" | "running" | "done" | "error";
  contextMode: "full" | "summary" | "none";
}

export interface WorkflowRun {
  id: string;
  startedAt: number;
  initialPrompt: string;
  steps: WorkflowStep[];
  status: "running" | "done" | "error";
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
