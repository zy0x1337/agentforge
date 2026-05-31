# AgentForge

> Browse and download local open-source LLMs, then orchestrate them into automated agent workflows — as a native Windows desktop app.

AgentForge is built on **Tauri v2 + React/TypeScript** and uses [Ollama](https://ollama.com) as the local LLM backend. Folders containing `.md` files define self-contained **agents** that can activate each other, pass context forward, and automatically decompose complex tasks into sequential or parallel steps.

![License](https://img.shields.io/badge/license-private-red) ![Tauri](https://img.shields.io/badge/Tauri-v2-blue) ![React](https://img.shields.io/badge/React-18-61dafb) ![Rust](https://img.shields.io/badge/Rust-1.77%2B-orange)

---

## Features

- **Model Manager** — View installed models, download popular ones with a single click via Ollama, pull any custom model by name, and set a default model for the app
- **Hugging Face GGUF Browser** — Search public HF repositories, filter by provider (bartowski, TheBloke, lmstudio-community, unsloth), sort by quant tag / size / VRAM estimate, download directly to a user-selected folder, and one-click import into Ollama
- **Quant Metadata** — Every GGUF file shows its quantisation tag (Q4_K_M, Q6_K, IQ4_XS, …), quality tier, bits-per-weight, and estimated VRAM requirement
- **Agent Explorer** — Open any folder as an agents directory; every subfolder becomes an agent defined by `.md` files with YAML frontmatter
- **Inline MD Editor** — CodeMirror 6 split-pane editor: syntax-highlighted markdown + YAML, live preview, structured Frontmatter Panel, dirty state (`●`), `Ctrl+S` to save, per-tab revert
- **Workflow Runner** — Enter a prompt; the router selects the best-matching agent, executes it, and passes structured output to the next agent in the chain
- **Parallel Agent Execution** — `workflow.md` steps with `mode: parallel` run multiple agents concurrently; results are fanned back in and merged before the next sequential step
- **Workflow Graph** — ReactFlow canvas that visualises the agent topology in real time (animated edges, per-node status) and as a static dependency map when idle
- **Streaming UI** — Every agent step streams output live as a chat bubble
- **Abort / Stop** — Cancel a running workflow at any point; the current step is marked `aborted` and the run is preserved in history
- **Run History** — Every completed or aborted run is stored in the sidebar; clicking an entry opens the Graph panel showing that run's execution path
- **Settings Panel** — Slide-over drawer: LLM, Agents, Routing mode, Appearance, Diagnostics. All changes persist immediately
- **Persistent Settings** — Default model, agents directory, Ollama base URL, theme, embedding model, and routing mode saved via `tauri-plugin-store`
- **Ollama Gate** — Detects whether Ollama is running; if not, offers one-click installation via `winget`

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | ≥ 20 | [nodejs.org](https://nodejs.org) |
| **pnpm** | ≥ 9 | `npm i -g pnpm` |
| **Rust** (stable) | ≥ 1.77 | [rustup.rs](https://rustup.rs) |
| **Ollama** | latest | [ollama.com/download](https://ollama.com/download) |
| **WebView2** | any | Pre-installed on Windows 10 22H2+ / Windows 11 |

> **Windows only:** Rust requires the Visual C++ Build Tools. Install via [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select **"Desktop development with C++"**.

---

## Getting Started

### 1. Clone

```bash
git clone https://github.com/zy0x1337/agentforge.git
cd agentforge
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start Ollama and pull a model

```bash
ollama serve
ollama pull llama3.2:3b          # minimum for development
ollama pull nomic-embed-text     # optional: enables semantic routing
```

### 4. Start the dev server

```bash
pnpm tauri:dev
```

> **Note:** The first build takes several minutes while Cargo compiles all Rust dependencies. Subsequent starts are significantly faster.

### 5. First-launch setup

Open **Settings** (gear icon) and configure:

| Setting | What to enter |
|---------|---------------|
| **Agents directory** | Absolute path to a folder with agent subfolders, e.g. `C:\Users\you\agentforge\agents` |
| **Default model** | An installed Ollama model name, e.g. `llama3.2:3b` |
| **Routing mode** | `Full` if `nomic-embed-text` is installed; otherwise `Rules + LLM` |

### 6. Frontend-only dev (optional)

```bash
pnpm dev   # → http://localhost:1420
```

---

## Production Build

```bash
pnpm tauri:build
```

Output in `src-tauri/target/release/bundle/`:

```
agentforge_0.1.0_x64-setup.exe   ← NSIS installer
agentforge_0.1.0_x64.msi         ← MSI package
```

---

## Project Structure

```
agentforge/
├── index.html
├── vite.config.ts
├── package.json
├── tsconfig.json
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles/
│   │   └── global.css
│   ├── store/
│   │   ├── useAppStore.ts
│   │   ├── useHistoryStore.ts
│   │   ├── useWorkflowStore.ts
│   │   └── useGraphStore.ts
│   ├── types/
│   │   └── index.ts
│   ├── lib/
│   │   ├── ollama.ts
│   │   ├── agentFs.ts
│   │   ├── router.ts
│   │   ├── embeddings.ts
│   │   ├── workflowRunner.ts      # sequential execution engine
│   │   ├── parallelRunner.ts      # parallel fan-out / fan-in engine  ← NEW
│   │   ├── graphLayout.ts
│   │   ├── hfHub.ts
│   │   ├── quantParser.ts         # GGUF quant tag parsing + VRAM estimates
│   │   ├── providers.ts           # known HF GGUF providers
│   │   ├── modelDownloader.ts     # download to folder + Ollama import
│   │   ├── modelSort.ts           # sort / filter enriched GGUF file list
│   │   └── settings.ts
│   └── components/
│       ├── shared/
│       │   ├── Sidebar.tsx
│       │   └── OllamaGate.tsx
│       ├── Settings/
│       │   └── SettingsPanel.tsx
│       ├── ModelManager/
│       │   └── ModelManager.tsx
│       ├── ModelBrowser/
│       │   ├── QuantBadge.tsx      # coloured quant tag badge with tooltip
│       │   ├── ProviderFilter.tsx  # provider checkbox filter
│       │   ├── DownloadButton.tsx  # progress bar + cancel + Ollama import
│       │   └── ModelFileTable.tsx  # sortable GGUF file table
│       ├── HfGgufBrowser/
│       │   ├── HfGgufBrowser.tsx
│       │   └── HfGgufBrowser.module.css
│       ├── AgentExplorer/
│       │   └── AgentExplorer.tsx
│       ├── AgentEditor/
│       │   ├── AgentEditor.tsx
│       │   ├── AgentEditor.module.css
│       │   ├── FrontmatterPanel.tsx
│       │   ├── FrontmatterPanel.module.css
│       │   └── useEditorStore.ts
│       ├── WorkflowGraph/
│       │   ├── WorkflowGraph.tsx
│       │   ├── AgentNode.tsx
│       │   └── EdgeWithLabel.tsx
│       └── ChatPanel/
│           ├── ChatPanel.tsx
│           └── StopButton.tsx
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       └── commands/
│           └── download.rs        # stub — logic lives in lib.rs
│
└── agents/
    ├── README.md
    ├── router/
    ├── coder/
    ├── reviewer/
    └── summarizer/
```

---

## Hugging Face GGUF Browser

The **HF GGUF Browser** provides full model discovery and direct download without leaving the app.

### Data flow

```
Search query + provider filter
    ↓
GET /api/models?search=...&filter=gguf
    ↓
Filter + sort by quant / size / VRAM
    ↓
Select file  →  DownloadButton
    ↓                 ↓
Open in browser   stream to models folder (Tauri FS)
                      ↓
               SHA-256 verify
                      ↓
               "Import into Ollama"  →  ollama create --file
```

### Provider badges

| Provider | Speciality |
|---|---|
| **bartowski** | IQ variants, frequently updated — ✓ recommended |
| **TheBloke** | Largest catalogue, legacy formats — ✓ recommended |
| **lmstudio-community** | Optimised for llama.cpp / LM Studio — ✓ recommended |
| **unsloth** | Dynamic quants (DQ), fine-tunes — ✓ recommended |
| mradermacher | Broad coverage including rare models |
| QuantFactory | Automated pipeline across many families |

### Quant quality tiers

| Tier | Tags | Best for |
|---|---|---|
| **Extreme** | Q8_0, F16, BF16 | Maximum quality, 16 GB+ VRAM |
| **High** | Q5_K_M, Q6_K | Near-lossless, 8 GB+ VRAM |
| **Balanced** | Q4_K_M ★, Q4_K_S, IQ4_XS | Best all-round — recommended default |
| **Compressed** | Q3_K_M, IQ3_M | Low-end GPU / iGPU |
| **Ultra-low** | Q2_K, IQ2_XXS | Testing / edge only |

---

## Agent System

### Concept

Every subfolder in the agents directory is a standalone **agent**. Agents are defined by `.md` files with YAML frontmatter. The workflow runner reads this metadata to determine execution order, parallelism, context passing, and model selection — automatically.

```
User Prompt
    ↓
Router  →  selects best-matching agent
    ↓
Agent A  →  executes, produces structured output
    ↓
┌──────────────────────────────────┐
│  Parallel group (mode: parallel) │
│  Agent B ──┐                     │
│  Agent C ──┼──→  fan-in merge    │
│  Agent D ──┘                     │
└──────────────────────────────────┘
    ↓
Agent E  →  receives merged context, finalises
```

### File Schema

#### `persona.md` *(required)*

```markdown
---
name: Coder
description: Writes clean TypeScript/React code from requirements
model: qwen2.5-coder:7b
triggers:
  - "write code"
  - "implement"
  - "create component"
next_agents:
  - reviewer
context_mode: summary   # "full" | "summary" | "none"
temperature: 0.3
max_tokens: 4096
---

You are a senior TypeScript developer…
```

#### `workflow.md` — sequential and parallel

```markdown
---
steps:
  - agent: router
  - agents: [coder, researcher]   # parallel group
    mode: parallel
    merge_strategy: concat         # "concat" | "summarise" | "vote"
  - agent: reviewer
  - agent: summarizer
---
```

#### `prompt.md` *(optional)*

Reusable template with `{{variable}}` placeholders.

#### `tools.md` *(Phase 3)*

Allowed shell commands with timeout (executed via Rust sidecar).

### Frontmatter Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✅ | Display name |
| `description` | `string` | ✅ | Used for router matching |
| `model` | `string` | — | Ollama model; falls back to app default |
| `triggers` | `string[]` | — | Keywords for trigger-based routing |
| `next_agents` | `string[]` | — | Agent IDs to activate after this one |
| `context_mode` | `"full" \| "summary" \| "none"` | — | Context forwarding strategy (default: `summary`) |
| `temperature` | `number` | — | 0.0–2.0 (default: `0.7`) |
| `max_tokens` | `number` | — | Max output tokens (default: `2048`) |

### Routing Logic

1. **Keyword match** — `triggers` scored against the prompt
2. **Semantic embeddings** — cosine similarity via `nomic-embed-text` (requires `Full` mode)
3. **LLM fallback** — model picks the best-suited agent from a list

### Parallel Execution

When a `workflow.md` step declares `mode: parallel`, the runner fans out to all listed agents concurrently using `Promise.allSettled`. Each agent receives the same input context. Results are merged according to `merge_strategy`:

| Strategy | Behaviour |
|---|---|
| `concat` | Results appended in declaration order (default) |
| `summarise` | A summariser agent condenses all results into one |
| `vote` | Majority-vote on structured `{choice, reason}` outputs |

Failed agents in a parallel group are logged but do not abort the run — the merge receives whatever succeeded.

### Abort Behaviour

Pressing **Stop** calls `AbortController.abort()`. The signal propagates through the entire call stack including all in-flight parallel fetch streams. Each stream reader is cancelled in a `finally` block. The run is pushed to history with `status: "aborted"`.

---

## Inline MD Editor

```
┌──────────────────────────────────────────────────────────────────┐
│  [persona.md ●] [prompt.md] [workflow.md] [tools.md]  [💾] [↺]  │
├──────────────────────────────────┬───────────────────────────────┤
│  CodeMirror 6                    │  Live MD preview              │  ← FM panel
│  (markdown + yaml)               │  (marked + DOMPurify)         │
└──────────────────────────────────┴───────────────────────────────┘
```

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save active tab |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |

---

## Workflow Graph

| Mode | Trigger | What's shown |
|------|---------|--------------|
| **Static** | No run active | Dependency graph from `next_agents` |
| **Live run** | Workflow executing | Real-time node states |
| **Parallel group** | `mode: parallel` active | Fan-out nodes with dashed edges, fan-in merge node |

### Node States

| State | Visual |
|-------|--------|
| `pending` | Muted, 60% opacity |
| `running` | Teal border + pulse ring |
| `done` | Green border |
| `error` | Red border |
| `aborted` | 45% opacity, neutral |

---

## Settings

| Section | Setting | Default |
|---------|---------|--------|
| LLM | Default model | — |
| LLM | Ollama base URL | `http://localhost:11434` |
| Agents | Agents directory | — |
| Routing | Routing mode | `Full` |
| Routing | Embedding model | `nomic-embed-text` |
| Appearance | Theme | `Dark` |

All settings saved to `%APPDATA%\AgentForge\settings.json`.

---

## Development

```bash
pnpm type-check          # TS check without building
pnpm lint                # ESLint
cd src-tauri && cargo check    # Rust compile check
cd src-tauri && cargo clippy   # Rust lints
```

---

## Roadmap

**Phase 1 — Core** ✅
- [x] Tauri v2 + React/TS boilerplate
- [x] Ollama REST client (list, pull, delete, streaming chat)
- [x] Agent FS reader (frontmatter parsing via gray-matter)
- [x] Keyword + LLM-based router
- [x] Workflow runner with agent chaining and context budgeting
- [x] Model Manager, Agent Explorer, Chat / Run Panel

**Phase 2 — Stability** ✅
- [x] Settings persistence (`tauri-plugin-store`)
- [x] Example agent pack (Router, Coder, Reviewer, Summarizer)
- [x] Abort signal (Stop button → `AbortController` → `fetch()`)
- [x] Run history with status, duration, agent chain, click-to-view
- [x] `workflow.md` sequential step parser
- [x] Semantic routing via embeddings
- [x] Settings panel (LLM, Agents, Routing, Appearance, Diagnostics)

**Phase 3 — Power Features** ✅
- [x] Workflow graph (ReactFlow + dagre, live + static)
- [x] Inline MD editor (CodeMirror 6, Frontmatter Panel, dirty state)
- [x] `tools.md` shell execution (Rust, allowlist, timeout)
- [x] HF GGUF browser (search, provider filter, quant metadata, direct download, SHA-256, Ollama import)
- [x] Parallel agent execution (fan-out / fan-in, merge strategies, abort propagation)

**Phase 4 — Distribution** *(next)*
- [ ] Persistent run history (saved to disk)
- [ ] App icon + bundle metadata
- [ ] GitHub Actions release build (`.exe` as release asset)
- [ ] Auto-updater (`tauri-plugin-updater`)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop framework | Tauri v2 |
| Frontend | React 18 + TypeScript 5 |
| State management | Zustand 4 |
| Build tool | Vite 5 |
| Backend | Rust 1.77+ |
| LLM runtime | Ollama |
| Graph visualization | @xyflow/react + dagre |
| MD editor | CodeMirror 6 |
| Model discovery | Hugging Face Hub REST API |
| MD parsing | gray-matter, marked, DOMPurify |
| Tauri plugins | fs, shell, http, dialog, store |

---

## License

Private repository — all rights reserved.
