# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend + Tauri desktop (primary dev workflow)
pnpm tauri:dev

# Frontend only (no Rust, no desktop APIs)
pnpm dev                  # → http://localhost:1420

# Type checking and linting
pnpm type-check           # tsc --noEmit
pnpm lint                 # ESLint, 0 warnings allowed

# Tests
pnpm test                 # vitest run (single pass)
pnpm test:watch           # vitest watch mode
pnpm test:coverage        # vitest + v8 coverage

# Rust (from src-tauri/)
cd src-tauri && cargo check
cd src-tauri && cargo clippy

# Production build
pnpm tauri:build          # output: src-tauri/target/release/bundle/
```

## Architecture

AgentForge is a **Tauri v2 + React/TypeScript** desktop app that uses Ollama as a local LLM backend. The `@` alias resolves to `src/`.

### Rust backend (`src-tauri/src/lib.rs`)

A single-file Tauri backend. All Tauri commands live here until the file exceeds ~400 lines. Current commands:

- `check_ollama` / `install_ollama` — Ollama health and installation
- `download_gguf` / `cancel_download` — streaming GGUF download with SHA-256 verification and per-download `AtomicBool` cancellation flags stored as Tauri app state (`CancelMap`)
- `import_gguf_to_ollama` — writes a temp Modelfile and runs `ollama create`
- `run_tool_command` — executes shell commands from `tools.md` with timeout watchdog

Events emitted to frontend: `download://progress`, `ollama://import`, `tool://output`, `tool://done`

### Zustand stores (`src/store/`)

Four stores, all independent (no cross-store imports):

| Store | Responsibility |
|---|---|
| `useAppStore` | Active panel, Ollama status, local models, agents list, persisted settings via `tauri-plugin-store` |
| `useWorkflowStore` | AbortController lifecycle, `RunEvent` dispatcher, `activeRun: WorkflowRun` with live `WorkflowStep[]` |
| `useHistoryStore` | Completed/aborted runs persisted to disk; hydrated from `tauri-plugin-store` on startup |
| `useGraphStore` | Subscribes to `useWorkflowStore.activeRun` via `subscribeWithSelector` and derives ReactFlow nodes/edges |

### Workflow execution (`src/lib/`)

Two-mode execution in `workflowRunner.ts`:

- **Static mode** — entry agent has `workflow.md`; its YAML `steps[]` drives the run
- **Dynamic mode** — follows `next_agents` frontmatter links, cycle-guarded

`workflowRunner.ts` dispatches parallel steps to `parallelRunner.ts`, which fans out via `Promise.allSettled` and merges results using `concat` | `summarise` | `vote`. All runners accept injected `deps` (dependency injection pattern) so both paths share the same `runSingleAgent` implementation.

`RunEvent` (discriminated union in `src/types/index.ts`) is the canonical event bus type. `workflowRunner` emits events; `useWorkflowStore.handleEvent` consumes them to build `WorkflowStep[]` for the graph and chat.

### Routing (`src/lib/router.ts`)

Three-tier fallback: **Tier 1** keyword match on `triggers[]` → **Tier 2** cosine similarity via `nomic-embed-text` embeddings (threshold 0.35) → **Tier 3** LLM picks from agent list. Agents with IDs starting with `_` are excluded from routing (reserved for `_global`, `_system`). `skipSemantic` / `skipLlm` flags map to the Settings routing mode options.

### Agent file format (`src/lib/agentFs.ts`)

Each subfolder of the configured `agentsDir` is an agent. Required file: `persona.md` (YAML frontmatter + system prompt body). Optional: `prompt.md` (additional user prompt), `workflow.md` (static workflow definition). Folders missing `persona.md` are silently skipped.

### Frontend panels (`src/components/`)

`App.tsx` renders one panel at a time based on `activePanel`. The Ollama gate blocks non-graph panels when Ollama is unreachable. Panels:

- `ModelManager/` — lists local Ollama models, pull by name, set default
- `HfGgufBrowser/` — Hugging Face GGUF search/download via `src/lib/hfHub.ts`; quant metadata via `src/lib/quantParser.ts`
- `AgentExplorer/` — lists agents, opens inline CodeMirror 6 editor (split pane MD + YAML)
- `ChatPanel/` — runs the workflow, streams output as chat bubbles
- `WorkflowGraph/` — ReactFlow canvas showing agent topology; animated during runs, static when idle
- `HistorySidebar/` — past runs list; clicking re-opens Graph for that run

## Key constraints

- **All Ollama calls are made from the frontend** via `src/lib/ollama.ts` using `tauri-plugin-http`. The Rust backend does not call Ollama.
- **Settings persist via `tauri-plugin-store`**, not localStorage. `loadSettings` / `saveSettings` in `src/lib/settings.ts` wrap the store plugin.
- **`@typescript-eslint/no-unused-vars`** treats `_`-prefixed names as intentionally unused. ESLint runs at zero warnings.
- `src-tauri/target/` is in `.gitignore`; never commit build artifacts.
