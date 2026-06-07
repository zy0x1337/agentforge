/**
 * ChatPanel — orchestrator.
 *
 * State ownership:
 *   agents, settings, localModels  → useAppStore
 *   isRunning, activeRun, …        → useWorkflowStore
 *   runs, activeRunId, addRun      → useHistoryStore
 *   input, attachments, routing    → local state (ephemeral per-session)
 */
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/useAppStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { runWorkflow, type WorkflowRunnerDeps } from "@/lib/workflowRunner";
import { routeToAgent } from "@/lib/router";
import { chatStream, normalizeModelName } from "@/lib/ollama";
import {
  readFileForContext,
  readFolderForContext,
  formatContextBlock,
  parseWriteFileBlocks,
  type AttachedFile,
  type FileWriteOp,
} from "@/lib/contextFiles";
import { FileChangeReview } from "./FileChangeReview";
import StopButton from "./StopButton";
import { RunDisplay, type RoutingTier } from "./RunDisplay";
import { PromptInputBar } from "./PromptInputBar";
import type { ChatMessage, WorkflowRun } from "@/types";

export default function ChatPanel() {
  const { agents, settings, localModels } = useAppStore();
  const { activeRun, isRunning, startRun, finishRun, handleEvent } = useWorkflowStore();
  const { runs, activeRunId, setActiveRunId, addRun } = useHistoryStore();

  const [input, setInput]               = useState("");
  const [runError, setRunError]         = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles]     = useState<AttachedFile[]>([]);
  const [attachedFolders, setAttachedFolders] = useState<string[]>([]);
  const [pendingWrites, setPendingWrites]     = useState<FileWriteOp[]>([]);
  const [routingTier, setRoutingTier]         = useState<RoutingTier | undefined>();
  const [routingScore, setRoutingScore]       = useState<number | undefined>();

  /** Prefer the user-selected history run, then live run, then most recent. */
  const displayRun: WorkflowRun | null =
    (activeRunId ? runs.find((r) => r.id === activeRunId) : null)
    ?? activeRun
    ?? runs[0]
    ?? null;

  // ── File attachment handlers ───────────────────────────────────────────────

  const attachFiles = async () => {
    const paths = await openDialog({ multiple: true, directory: false });
    if (!paths) return;
    const list = Array.isArray(paths) ? paths : [paths];
    const results = await Promise.all(list.map(readFileForContext));
    const valid = results.filter(Boolean) as AttachedFile[];
    setAttachedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      return [...prev, ...valid.filter((f) => !existing.has(f.path))];
    });
  };

  const attachFolder = async () => {
    const folder = await openDialog({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    setAttachedFolders((prev) => prev.includes(folder) ? prev : [...prev, folder]);
    const { files, skipped } = await readFolderForContext(folder);
    setAttachedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      return [...prev, ...files.filter((f) => !existing.has(f.path))];
    });
    if (skipped > 0) {
      setRunError(`${skipped} file(s) skipped (binary / too large / limit reached)`);
    }
  };

  // ── Run ───────────────────────────────────────────────────────────────────

  const run = async () => {
    if (!input.trim() || isRunning || !settings.defaultModel) return;
    const prompt = input.trim();
    setInput("");
    setRunError(null);
    setRoutingTier(undefined);
    setRoutingScore(undefined);

    const contextBlock = formatContextBlock(attachedFiles, attachedFolders);
    const fullPrompt   = contextBlock + prompt;

    const runId  = crypto.randomUUID();
    const signal = startRun(runId, prompt);
    setActiveRunId(runId);

    try {
      // ── Route ──────────────────────────────────────────────────────────────
      const routeResult = await routeToAgent(fullPrompt, agents, settings.defaultModel, {
        baseUrl:       settings.ollamaBaseUrl,
        embedModel:    settings.embedModel,
        skipSemantic:
          settings.routingMode === "no-semantic" ||
          settings.routingMode === "rules-only",
        skipLlm: settings.routingMode === "rules-only",
        signal,
      });
      if (!routeResult) throw new Error("No agent matched this prompt");

      setRoutingTier(routeResult.tier);
      setRoutingScore(routeResult.score);

      // ── Build runner deps ──────────────────────────────────────────────────
      const agentById = new Map(agents.map((a) => [a.id, a]));

      const deps: WorkflowRunnerDeps = {
        runSingleAgent: async (agentId, inputContext, sig, onChunk, overrides) => {
          const agent = agentById.get(agentId);
          if (!agent) throw new Error(`Unknown agent: ${agentId}`);
          const agentModel = agent.frontmatter.model;
          const agentModelInstalled =
            !!agentModel &&
            localModels.some(
              (m) => normalizeModelName(m.name) === normalizeModelName(agentModel),
            );
          const model =
            overrides?.model ||
            (agentModelInstalled ? agentModel : null) ||
            settings.defaultModel;
          const temperature =
            overrides?.temperature ?? agent.frontmatter.temperature ?? 0.7;
          const system = agent.persona + (agent.prompt ? `\n\n${agent.prompt}` : "");
          const messages: ChatMessage[] = [
            { role: "system", content: system },
            { role: "user",   content: inputContext || fullPrompt },
          ];
          let out = "";
          await chatStream(
            model,
            messages,
            (token) => { out += token; onChunk(token); },
            temperature,
            sig,
            settings.ollamaBaseUrl,
          );
          return out;
        },

        emitEvent: handleEvent,

        getAgentMeta: (agentId) => {
          const a = agentById.get(agentId);
          if (!a) return undefined;
          return {
            id: a.id,
            model: a.frontmatter.model,
            maxTokens: a.frontmatter.max_tokens,
            contextMode: a.frontmatter.context_mode,
            nextAgents: a.frontmatter.next_agents,
          };
        },

        readAgentFile: async (agentId, filename) => {
          const a = agentById.get(agentId);
          if (!a) return null;
          if (filename === "workflow.md") return a.workflow ?? null;
          if (filename === "persona.md")  return a.persona ?? null;
          if (filename === "prompt.md")   return a.prompt ?? null;
          return null;
        },
      };

      await runWorkflow(routeResult.agent.id, fullPrompt, signal, deps, runId);

      // Persist finished run and scan for file-write proposals.
      const finished = useWorkflowStore.getState().activeRun;
      if (finished) await addRun(finished);

      const allOutput = finished?.steps.map((s) => s.output ?? "").join("\n") ?? "";
      const writes = parseWriteFileBlocks(allOutput);
      if (writes.length > 0) setPendingWrites(writes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunError(msg);
    } finally {
      finishRun();
    }
  };

  const canSubmit = !isRunning && !!input.trim() && !!settings.defaultModel;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Header */}
      <div style={{
        padding: "var(--space-4) var(--space-6)",
        borderBottom: "1px solid oklch(from var(--text) l c h / 0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Agent Run</span>
          {displayRun && displayRun.status !== "running" && (
            <span style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-faint)",
              fontFamily: "var(--font-mono)",
            }}>
              {displayRun.status}
              {displayRun.finishedAt &&
                ` · ${Math.round((displayRun.finishedAt - displayRun.startedAt) / 1000)}s`}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {settings.defaultModel
            ? <span style={{
                fontSize: "var(--text-xs)",
                color: "var(--primary)",
                fontFamily: "var(--font-mono)",
              }}>
                {settings.defaultModel}
              </span>
            : <span style={{ fontSize: "var(--text-xs)", color: "var(--error)" }}>
                No default model — set one in Models
              </span>
          }
          {isRunning && (
            <span style={{
              fontSize: "var(--text-xs)",
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-1)",
            }}>
              <span style={{
                display: "inline-block",
                width: 6, height: 6,
                borderRadius: "50%",
                background: "var(--warning)",
                animation: "pulse 1.2s ease-in-out infinite",
              }} />
              running
            </span>
          )}
        </div>
      </div>

      {/* Message list */}
      <RunDisplay
        displayRun={displayRun}
        isRunning={isRunning}
        runError={runError}
        agents={agents}
        routingTier={routingTier}
        routingScore={routingScore}
      />

      {/* Stop button */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        minHeight: isRunning ? 40 : 0,
        overflow: "hidden",
        transition: "min-height 160ms ease",
        flexShrink: 0,
      }}>
        <StopButton />
      </div>

      {/* File change review overlay */}
      {pendingWrites.length > 0 && (
        <FileChangeReview
          ops={pendingWrites}
          onClose={() => setPendingWrites([])}
        />
      )}

      {/* Input bar */}
      <PromptInputBar
        input={input}
        setInput={setInput}
        isRunning={isRunning}
        canSubmit={canSubmit}
        attachedFiles={attachedFiles}
        attachedFolders={attachedFolders}
        onRun={run}
        onAttachFiles={attachFiles}
        onAttachFolder={attachFolder}
        onRemoveFile={(path) => setAttachedFiles((prev) => prev.filter((f) => f.path !== path))}
        onRemoveFolder={(folder) => setAttachedFolders((prev) => prev.filter((f) => f !== folder))}
        onClearAll={() => { setAttachedFiles([]); setAttachedFolders([]); }}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
