import { useRef, useEffect } from "react";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import type { Agent, WorkflowRun, AgentResult, MergeStrategy } from "@/types";

// ── Routing badge ─────────────────────────────────────────────────────────────

export type RoutingTier = "keyword" | "semantic" | "llm";

function RoutingBadge({ tier, score }: { tier: RoutingTier; score?: number }) {
  const label =
    tier === "keyword"
      ? "Keyword match"
      : tier === "semantic"
        ? `Semantic${score !== undefined ? ` ${score.toFixed(2)}` : ""}`
        : "LLM fallback";

  const color =
    tier === "keyword"
      ? "var(--success)"
      : tier === "semantic"
        ? "var(--primary)"
        : "var(--warning)";

  const icon = tier === "keyword" ? "●" : tier === "semantic" ? "◎" : "◆";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      padding: "var(--space-1) 0 var(--space-2)",
    }}>
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "2px var(--space-2)",
        background: `oklch(from ${color} l c h / 0.12)`,
        color,
        borderRadius: "var(--radius-full)",
        fontFamily: "var(--font-mono)",
        fontSize: "0.65rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}>
        {icon} {label}
      </span>
    </div>
  );
}

// ── User bubble ───────────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{
        background: "var(--primary)",
        color: "#fff",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-lg)",
        maxWidth: "70%",
        fontSize: "var(--text-sm)",
        lineHeight: 1.5,
      }}>
        {text}
      </div>
    </div>
  );
}

// ── Agent bubble ──────────────────────────────────────────────────────────────

type ParallelGroupMeta = {
  agentIds: string[];
  results: AgentResult[];
  mergedOutput: string;
  strategy: MergeStrategy;
  succeededCount: number;
  totalDurationMs: number;
};

function AgentBubble({
  agentId,
  content,
  status,
  agents,
  parallelGroup,
}: {
  agentId?: string;
  content: string;
  status: string;
  agents: Agent[];
  parallelGroup?: ParallelGroupMeta;
}) {
  const agent      = agentId ? agents.find((a) => a.id === agentId) : null;
  const isAborted  = status === "aborted";
  const isError    = status === "error";
  const isRunning  = status === "running";
  const isParallel = !!parallelGroup;

  const borderColor = isAborted
    ? "oklch(from var(--warning) l c h / 0.25)"
    : isError
      ? "oklch(from var(--error) l c h / 0.25)"
      : "oklch(from var(--text) l c h / 0.08)";

  const bgColor = isAborted
    ? "color-mix(in oklab, var(--warning) 6%, var(--surface-2))"
    : isError
      ? "color-mix(in oklab, var(--error) 6%, var(--surface-2))"
      : "var(--surface-2)";

  return (
    <div>
      {/* Label row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        marginBottom: "var(--space-2)",
        flexWrap: "wrap",
      }}>
        {isParallel ? (
          <>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--accent)", fontWeight: 600 }}>
              ⟳ Parallel · {parallelGroup!.strategy}
            </span>
            <span style={{
              fontSize: "var(--text-xs)",
              color: parallelGroup!.succeededCount === parallelGroup!.agentIds.length
                ? "var(--success)"
                : "var(--warning)",
            }}>
              {parallelGroup!.succeededCount}/{parallelGroup!.agentIds.length} ok
            </span>
            {parallelGroup!.totalDurationMs > 0 && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
                · {(parallelGroup!.totalDurationMs / 1000).toFixed(1)}s
              </span>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--primary)", fontWeight: 600 }}>
              ◈ {agent?.frontmatter.name ?? agentId}
            </span>
            {isRunning && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>…</span>
            )}
            {isError && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>error</span>
            )}
            {isAborted && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--warning)" }}>aborted</span>
            )}
          </>
        )}
      </div>

      {/* Bubble */}
      <div style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.7,
        color: (isAborted || isError) ? "var(--text-muted)" : "var(--text)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxWidth: "85%",
      }}>
        {content ? (
          <>
            {content}
            {isRunning && (
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: "0.45em",
                  height: "1.1em",
                  background: "var(--primary)",
                  marginLeft: 2,
                  borderRadius: 1,
                  verticalAlign: "text-bottom",
                  animation: "cursor-blink 1s steps(1) infinite",
                }}
              />
            )}
          </>
        ) : isRunning ? (
          <span style={{ color: "var(--text-faint)" }}>
            Thinking<span style={{ animation: "cursor-blink 1.2s steps(1) infinite" }}>…</span>
          </span>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>No output</span>
        )}
      </div>
    </div>
  );
}

// ── RunDisplay ────────────────────────────────────────────────────────────────

interface RunDisplayProps {
  displayRun: WorkflowRun | null;
  isRunning: boolean;
  runError: string | null;
  agents: Agent[];
  routingTier?: RoutingTier;
  routingScore?: number;
}

export function RunDisplay({
  displayRun,
  isRunning,
  runError,
  agents,
  routingTier,
  routingScore,
}: RunDisplayProps) {
  const { activeRun } = useWorkflowStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  const streamedLength =
    activeRun?.steps.map((s) => s.output).join("").length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayRun?.steps.length, streamedLength]);

  return (
    <>
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}>
        {!displayRun ? (
          /* ── Empty state ──────────────────────────────────────────────── */
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "var(--space-3)",
            color: "var(--text-muted)",
            marginTop: "var(--space-16)",
          }}>
            <svg
              width="36" height="36" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="1.2"
              aria-hidden="true"
              style={{ opacity: 0.4 }}
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
              Start a workflow
            </p>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
              {agents.length > 0
                ? `${agents.length} agent${agents.length !== 1 ? "s" : ""} ready`
                : "No agents loaded — pick a folder in Agents"}
            </p>
          </div>
        ) : (
          <>
            <UserBubble text={displayRun.initialPrompt} />

            {routingTier && (
              <RoutingBadge tier={routingTier} score={routingScore} />
            )}

            {displayRun.steps.map((step, i) => (
              <AgentBubble
                key={`${step.agentId ?? "parallel"}-${i}`}
                agentId={step.agentId}
                content={step.output ?? ""}
                status={step.status}
                agents={agents}
                parallelGroup={step.parallelGroup}
              />
            ))}

            {/* Routing indicator: run active but no step has started yet */}
            {isRunning && !displayRun.steps.some((s) => s.status === "running") && (
              <div style={{
                color: "var(--text-muted)",
                fontSize: "var(--text-xs)",
                padding: "var(--space-2) 0",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}>
                <span style={{
                  display: "inline-block",
                  width: 6, height: 6,
                  borderRadius: "50%",
                  background: "var(--primary)",
                  animation: "pulse 1.2s ease-in-out infinite",
                }} />
                Routing…
              </div>
            )}
          </>
        )}

        {runError && (
          <div style={{
            padding: "var(--space-3) var(--space-4)",
            background: "color-mix(in oklab, var(--error) 8%, var(--surface-2))",
            border: "1px solid oklch(from var(--error) l c h / 0.3)",
            borderRadius: "var(--radius-md)",
            color: "var(--error)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-mono)",
          }}>
            {runError}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <style>{`
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
