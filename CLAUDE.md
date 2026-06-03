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

### Tauri v2 capabilities (`src-tauri/capabilities/`)

Plugin scopes are **not** configured in `tauri.conf.json` in Tauri v2 — they live in separate capability files:

| File | Purpose |
|---|---|
| `fs-scope.json` | `fs:allow-read-dir/text-file/write-text-file/mkdir/remove` scoped to `$HOME/**` and `$APPDATA/**`, denying `$HOME/.ssh/**` |
| `shell-commands.json` | `shell:allow-execute` for `ollama` and `winget` commands |
| `http-scope.json` | `http:allow-fetch` for Ollama and HuggingFace URLs |
| `dialog.json` | `dialog:allow-open` for folder/file pickers |
| `store.json` | `store:allow-*` for `tauri-plugin-store` |

`tauri.conf.json` `plugins` section only contains `shell: { open: true }`. Everything else moved to capabilities.

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

Three-tier fallback: **Tier 1** keyword match on `triggers[]` → **Tier 2** cosine similarity via `nomic-embed-text` embeddings (threshold 0.35) → **Tier 3** LLM picks from agent list. Agents with IDs starting with `_` are excluded from routing. `skipSemantic` / `skipLlm` flags map to the Settings routing mode options.

### Agent file format (`src/lib/agentFs.ts`)

Each subfolder of the configured `agentsDir` is an agent. Required file: `persona.md` (YAML frontmatter + system prompt body). Optional: `prompt.md`, `workflow.md`. `agentsDir` paths are normalized (trailing slashes stripped) before use.

Key functions: `loadAgents`, `saveAgentFile`, `createAgent`, `deleteAgent` (recursive remove).

### Model name normalization (`src/lib/ollama.ts`)

`normalizeModelName(name)` strips `:latest` suffix. Use it on both sides of any model-name comparison — Ollama stores `nomic-embed-text:latest` but frontmatter and settings store `nomic-embed-text`.

`chatStream` throws on non-OK Ollama responses (e.g. model not found) rather than silently returning empty output.

`listLocalModels` failures return `null` not `[]` — callers must guard `if (models !== null)` to avoid wiping the model list on transient Ollama restarts.

### Frontend panels (`src/components/`)

`App.tsx` renders one panel at a time based on `activePanel`. The Ollama gate blocks non-graph panels when Ollama is unreachable.

- **`ModelManager/`** — "Required by agents" section at top lists every model referenced in agent frontmatter + embed model; shows install status + one-click Pull. Pull progress shown as animated bar in the Custom Model section. Two-step confirm before deleting a model.
- **`HfGgufBrowser/`** — HuggingFace GGUF search/download; quant metadata via `src/lib/quantParser.ts`
- **`AgentExplorer/`** — collapsible agent list (‹/› toggle); per-agent delete with two-step confirm; opens inline `AgentEditor` (CodeMirror 6 + live preview + FrontmatterPanel, all three panes independently collapsible)
- **`ChatPanel/`** — workflow runner with file/folder context attachment, controlled file write review
- **`WorkflowGraph/`** — ReactFlow canvas; animated during runs, static when idle
- **`HistorySidebar/`** — past runs; clicking re-opens Graph for that run

### AgentEditor (`src/components/AgentEditor/`)

- `useEditorStore.ts` — tracks file contents, dirty state, `lastSaved` timestamp (bumped after every `save()` and `saveTab()`)
- `AgentExplorer` watches `lastSaved` and reloads `useAppStore.agents` after every editor save, so frontmatter changes (e.g. model selection) take effect immediately without restarting
- `FrontmatterPanel` model field is a `<select>` populated from `localModels`; uninstalled models shown with ⚠ label

### Context upload & file write review (`src/lib/contextFiles.ts`, `src/components/ChatPanel/`)

**Context attachment** — files and folders can be attached to a chat prompt. Attached folder paths are always injected into the context even when empty (so the agent knows where to write files). Format:

```
[Attached context — 1 folder]
Working directories (use these absolute paths when writing files):
  - C:\Users\...\Test
[End context]
```

**Controlled file writes** — agents signal file modifications using:
```
<write_file path="ABSOLUTE_PATH">
content
</write_file>
```
`parseWriteFileBlocks` also detects the fallback markdown format `**path/to/file.ext**` + code fence for models that ignore the XML instruction. After each run, detected writes open `FileChangeReview` — a bottom-sheet overlay with per-file LCS diff (±3 context lines), per-item Apply/Reject, and Apply all. Nothing is written to disk until explicitly approved. Errors shown inline per file with a Retry button.

### Coder agent (`agents/coder/persona.md`)

The `<write_file>` protocol is documented at the top of the system prompt (marked CRITICAL) so models prioritise it over the general markdown code-block output format.

## Key constraints

- **All Ollama calls are made from the frontend** via `src/lib/ollama.ts` using native `fetch` (not `tauri-plugin-http`). The Rust backend does not call Ollama.
- **Settings persist via `tauri-plugin-store`**, not localStorage. `loadSettings` / `saveSettings` in `src/lib/settings.ts` wrap the store plugin.
- **`@typescript-eslint/no-unused-vars`** treats `_`-prefixed names as intentionally unused. ESLint runs at zero warnings.
- **`Buffer` polyfill** is injected at the top of `src/main.tsx` so `gray-matter` works in the browser (Vite doesn't provide Node globals).
- `src-tauri/target/` is in `.gitignore`; never commit build artifacts.
- When adding new `fs` operations, add the corresponding `fs:allow-*` permission to `src-tauri/capabilities/fs-scope.json` with the same `$HOME/**` / `$APPDATA/**` scope.
