import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { runWorkflow } from "@/lib/workflowRunner";
import type { Agent } from "@/types";

export default function ChatPanel() {
  const {
    agents, settings,
    setActiveRun, addRunStep, activeRun,
    streamBuffer, appendStream, clearStream,
  } = useAppStore();
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeRun?.steps.length, streamBuffer]);

  const run = async () => {
    if (!input.trim() || isRunning || !settings.defaultModel) return;
    const prompt = input.trim();
    setInput("");
    clearStream();
    setIsRunning(true);
    setActiveRun({ id: crypto.randomUUID(), startedAt: Date.now(), initialPrompt: prompt, steps: [], status: "running" });

    await runWorkflow(
      prompt, agents,
      settings.defaultModel, settings.defaultModel,
      addRunStep,
      appendStream
    ).catch(console.error);

    setIsRunning(false);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "var(--space-4) var(--space-6)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Agent Run</span>
        {settings.defaultModel
          ? <span style={{ fontSize: "var(--text-xs)", color: "var(--primary)", fontFamily: "var(--font-mono)" }}>{settings.defaultModel}</span>
          : <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>No default model — set one in Models</span>}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {!activeRun && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "var(--space-3)", color: "var(--text-muted)" }}>
            <span style={{ fontSize: "2rem" }}>▶</span>
            <p style={{ fontSize: "var(--text-sm)" }}>Enter a prompt to start a workflow</p>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{agents.length} agent{agents.length !== 1 ? "s" : ""} loaded</p>
          </div>
        )}
        {activeRun && (
          <>
            <UserBubble text={activeRun.initialPrompt} />
            {activeRun.steps.map((step, i) => (
              <AgentBubble key={`${step.agentId}-${i}`} agentId={step.agentId} content={step.output ?? (streamBuffer[step.agentId] ?? "")} status={step.status} agents={agents} />
            ))}
            {isRunning && !activeRun.steps.some((s) => s.status === "running") && (
              <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>Routing…</div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "var(--space-4) var(--space-6)", borderTop: "1px solid var(--border)", display: "flex", gap: "var(--space-3)" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
          placeholder="Enter a prompt… (Shift+Enter for newline)"
          rows={2}
          style={{ flex: 1, padding: "var(--space-3)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text)", resize: "none", fontSize: "var(--text-sm)" }}
        />
        <button
          onClick={run}
          disabled={isRunning || !input.trim() || !settings.defaultModel}
          style={{ padding: "var(--space-3) var(--space-6)", background: "var(--primary)", color: "#fff", borderRadius: "var(--radius-md)", fontSize: "var(--text-sm)", opacity: (isRunning || !input.trim()) ? 0.5 : 1, alignSelf: "flex-end" }}
        >
          {isRunning ? "…" : "▶ Run"}
        </button>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{ background: "var(--primary)", color: "#fff", padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-lg)", maxWidth: "70%", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

function AgentBubble({ agentId, content, status, agents }: { agentId: string; content: string; status: string; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === agentId);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--accent)", fontWeight: 600 }}>◈ {agent?.frontmatter.name ?? agentId}</span>
        {status === "running" && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>…</span>}
        {status === "error" && <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>error</span>}
      </div>
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", fontSize: "var(--text-sm)", lineHeight: 1.7, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: "85%" }}>
        {content || <span style={{ color: "var(--text-faint)" }}>Thinking…</span>}
      </div>
    </div>
  );
}
