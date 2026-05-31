/**
 * workflowParser.ts
 *
 * Parses a workflow.md file (raw string) into a typed WorkflowDefinition.
 *
 * Supported workflow.md structure:
 *
 * ---
 * steps:
 *   - agent: router
 *   - agent: coder
 *     prompt_override: "Focus only on TypeScript. Task: {{input}}"
 *     model: qwen2.5-coder:7b
 *     temperature: 0.2
 *     context_mode: full
 *     condition: "previous_output contains 'needs implementation'"
 *   - agent: reviewer
 * mode: sequential          # sequential | parallel (parallel reserved for Phase 3)
 * on_error: stop            # stop | continue | retry
 * max_retries: 1            # only relevant when on_error: retry
 * description: "End-to-end code creation and review pipeline"
 * ---
 *
 * The markdown body (below the frontmatter) is treated as a human-readable
 * description and is stored in WorkflowDefinition.description if no YAML
 * description field is set.
 */

import matter from "gray-matter";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkflowMode = "sequential" | "parallel";
export type OnErrorBehaviour = "stop" | "continue" | "retry";

export interface WorkflowStepDef {
  /** Folder name / agent ID to execute. */
  agent: string;

  /**
   * Optional prompt template for this specific step.
   * Supports {{input}} (original user prompt) and {{previous}} (previous output).
   * When omitted the agent's own prompt.md template (or bare user prompt) is used.
   */
  prompt_override?: string;

  /** Override the agent's persona-level model for this step only. */
  model?: string;

  /** Override temperature for this step (0.0 – 1.0). */
  temperature?: number;

  /** Override context_mode for this step. */
  context_mode?: "full" | "summary" | "none";

  /**
   * Simple condition string evaluated at runtime.
   * Syntax: "previous_output contains '<substring>'"
   *         "previous_output matches '<regex>'"
   *         "step_count < 3"
   * Step is skipped when the condition evaluates to false.
   */
  condition?: string;
}

export interface WorkflowDefinition {
  /** Ordered list of steps to execute. */
  steps: WorkflowStepDef[];

  /** Execution mode — only "sequential" is implemented; "parallel" is Phase 3. */
  mode: WorkflowMode;

  /** What to do when a step errors out. Default: "stop". */
  onError: OnErrorBehaviour;

  /** How many times to retry a failed step when onError is "retry". Default: 1. */
  maxRetries: number;

  /** Human-readable description sourced from YAML field or markdown body. */
  description: string;

  /** Raw source preserved for debugging / display in Agent Explorer. */
  raw: string;
}

// ── Parse errors ──────────────────────────────────────────────────────────────

export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(`[workflowParser] ${message}`);
    this.name = "WorkflowParseError";
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidMode(v: unknown): v is WorkflowMode {
  return v === "sequential" || v === "parallel";
}

function isValidOnError(v: unknown): v is OnErrorBehaviour {
  return v === "stop" || v === "continue" || v === "retry";
}

function parseSteps(raw: unknown, source: string): WorkflowStepDef[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new WorkflowParseError(
      "'steps' must be a non-empty array.",
      source
    );
  }

  return raw.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new WorkflowParseError(
        `Step at index ${index} must be an object.`,
        source
      );
    }

    const step = item as Record<string, unknown>;

    if (typeof step.agent !== "string" || !step.agent.trim()) {
      throw new WorkflowParseError(
        `Step ${index}: 'agent' field must be a non-empty string.`,
        source
      );
    }

    const def: WorkflowStepDef = { agent: step.agent.trim() };

    if (step.prompt_override !== undefined) {
      if (typeof step.prompt_override !== "string") {
        throw new WorkflowParseError(
          `Step ${index}: 'prompt_override' must be a string.`,
          source
        );
      }
      def.prompt_override = step.prompt_override;
    }

    if (step.model !== undefined) {
      if (typeof step.model !== "string") {
        throw new WorkflowParseError(
          `Step ${index}: 'model' must be a string.`,
          source
        );
      }
      def.model = step.model;
    }

    if (step.temperature !== undefined) {
      const t = Number(step.temperature);
      if (isNaN(t) || t < 0 || t > 1) {
        throw new WorkflowParseError(
          `Step ${index}: 'temperature' must be a number between 0 and 1.`,
          source
        );
      }
      def.temperature = t;
    }

    if (step.context_mode !== undefined) {
      if (
        step.context_mode !== "full" &&
        step.context_mode !== "summary" &&
        step.context_mode !== "none"
      ) {
        throw new WorkflowParseError(
          `Step ${index}: 'context_mode' must be "full", "summary", or "none".`,
          source
        );
      }
      def.context_mode = step.context_mode;
    }

    if (step.condition !== undefined) {
      if (typeof step.condition !== "string") {
        throw new WorkflowParseError(
          `Step ${index}: 'condition' must be a string.`,
          source
        );
      }
      def.condition = step.condition;
    }

    return def;
  });
}

// ── Main parse function ───────────────────────────────────────────────────────

/**
 * Parse a workflow.md file contents into a WorkflowDefinition.
 *
 * Throws WorkflowParseError on invalid structure.
 */
export function parseWorkflow(source: string): WorkflowDefinition {
  let parsed: ReturnType<typeof matter>;

  try {
    parsed = matter(source);
  } catch (e) {
    throw new WorkflowParseError(
      `YAML frontmatter parse failed: ${String(e)}`,
      source
    );
  }

  const fm = parsed.data as Record<string, unknown>;
  const body = (parsed.content ?? "").trim();

  // ── steps (required) ──────────────────────────────────────────────────────
  const steps = parseSteps(fm.steps, source);

  // ── mode ──────────────────────────────────────────────────────────────────
  const mode: WorkflowMode = isValidMode(fm.mode) ? fm.mode : "sequential";
  if (mode === "parallel") {
    console.warn(
      "[workflowParser] 'parallel' mode is not yet implemented — falling back to 'sequential'."
    );
  }

  // ── on_error ──────────────────────────────────────────────────────────────
  const onError: OnErrorBehaviour = isValidOnError(fm.on_error)
    ? fm.on_error
    : "stop";

  // ── max_retries ───────────────────────────────────────────────────────────
  const maxRetries =
    typeof fm.max_retries === "number" && fm.max_retries >= 0
      ? Math.floor(fm.max_retries)
      : 1;

  // ── description ───────────────────────────────────────────────────────────
  const description =
    typeof fm.description === "string" && fm.description.trim()
      ? fm.description.trim()
      : body || "";

  return { steps, mode, onError, maxRetries, description, raw: source };
}

// ── Condition evaluator ───────────────────────────────────────────────────────

/**
 * Evaluate a simple condition string at runtime.
 *
 * Supported syntax:
 *   previous_output contains '<substring>'
 *   previous_output matches '<regex>'
 *   step_count < N
 *   step_count <= N
 *   step_count > N
 *   step_count >= N
 *   step_count == N
 *
 * Returns true (run the step) when the condition string is empty or undefined.
 */
export function evaluateCondition(
  condition: string | undefined,
  ctx: { previousOutput: string; stepCount: number }
): boolean {
  if (!condition || !condition.trim()) return true;

  const c = condition.trim();

  // previous_output contains '<text>'
  const containsMatch = c.match(
    /^previous_output\s+contains\s+'([^']*)'/i
  );
  if (containsMatch) {
    return ctx.previousOutput
      .toLowerCase()
      .includes(containsMatch[1].toLowerCase());
  }

  // previous_output matches '<regex>'
  const matchesMatch = c.match(
    /^previous_output\s+matches\s+'([^']*)'/i
  );
  if (matchesMatch) {
    try {
      return new RegExp(matchesMatch[1], "i").test(ctx.previousOutput);
    } catch {
      console.warn(`[workflowParser] Invalid regex in condition: ${c}`);
      return true;
    }
  }

  // step_count <operator> N
  const countMatch = c.match(
    /^step_count\s*(<=|>=|<|>|==)\s*(\d+)/
  );
  if (countMatch) {
    const op = countMatch[1];
    const n = parseInt(countMatch[2], 10);
    switch (op) {
      case "<":  return ctx.stepCount < n;
      case "<=": return ctx.stepCount <= n;
      case ">": return ctx.stepCount > n;
      case ">=": return ctx.stepCount >= n;
      case "==": return ctx.stepCount === n;
    }
  }

  console.warn(`[workflowParser] Unrecognised condition syntax — skipping: "${c}"`);
  return true;
}
