# AgentForge

> Browse and download local open-source LLMs, then orchestrate them into automated agent workflows — as a native Windows desktop app.

AgentForge is built on **Tauri v2 + React/TypeScript** and uses [Ollama](https://ollama.com) as the local LLM backend. Folders containing `.md` files define self-contained **agents** that can activate each other, pass context forward, and automatically decompose complex tasks into sequential steps.

![License](https://img.shields.io/badge/license-private-red) ![Tauri](https://img.shields.io/badge/Tauri-v2-blue) ![React](https://img.shields.io/badge/React-18-61dafb) ![Rust](https://img.shields.io/badge/Rust-1.77%2B-orange)

---

## Features

- **Model Manager** — View installed models, download popular ones with a single click via Ollama, pull any custom model by name, and set a default model for the app
- **Agent Explorer** — Open any folder as an agents directory; every subfolder becomes an agent defined by `.md` files with YAML frontmatter
- **Workflow Runner** — Enter a prompt; the router selects the best-matching agent, executes it, and passes structured output to the next agent in the chain
- **Streaming UI** — Every agent step streams output live as a chat bubble in real time
- **Abort / Stop** — Cancel a running workflow at any point; the current step is marked `aborted` and the run is preserved in history
- **Run History** — Every completed or aborted run is stored in the sidebar with status indicator, timestamp, duration, and the agent chain that ran
- **Settings Panel** — Slide-over drawer with sections for LLM, Agents, Routing mode, Appearance (dark/light/system), and diagnostics (embedding cache). All changes persist immediately
- **Persistent Settings** — Default model, agents directory, Ollama base URL, theme, embedding model, and routing mode are saved to disk via `tauri-plugin-store` and restored on next launch
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

### 1. Clone the repository

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
# Ollama must be running in the background
ollama serve

# Pull at least one model (small and fast for development)
ollama pull llama3.2:3b

# Optional: pull the embedding model for semantic routing
ollama pull nomic-embed-text
```

### 4. Start the dev server

```bash
pnpm tauri:dev
```

> **Note:** The first build takes several minutes while Cargo compiles all Rust dependencies. Subsequent starts are significantly faster thanks to incremental compilation.

### 5. First launch — required setup

On first launch, open the **Settings panel** (gear icon in the sidebar footer) and configure:

| Setting | What to enter |
|---------|---------------|
| **Agents directory** | Absolute path to a folder containing agent subfolders, e.g. `C:\Users\you\agentforge\agents` |
| **Default model** | An Ollama model name you have pulled, e.g. `llama3.2:3b` |
| **Routing mode** | `Full` (recommended) if `nomic-embed-text` is installed; otherwise `Rules + LLM` |

Settings are saved automatically and restored on next launch.

### 6. Frontend-only development (optional)

```bash
pnpm dev
# → http://localhost:1420
```

Without the Tauri context, filesystem access and shell commands are unavailable. Sufficient for pure UI work.

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

> Release builds are size-optimized via `opt-level = "s"`, LTO, and strip.

---

## Project Structure

```
agentforge/
├── index.html                    # Tauri WebView entry point
├── vite.config.ts
├── package.json
├── tsconfig.json
│
├── src/                          # React + TypeScript frontend
│   ├── main.tsx                  # ReactDOM entry
│   ├── App.tsx                   # Root component, settings load, Ollama health polling
│   ├── styles/
│   │   └── global.css            # Design tokens (CSS custom properties)
│   ├── store/
│   │   ├── useAppStore.ts        # Zustand: models, agents, UI state, settings (theme, embedModel, routingMode)
│   │   ├── useHistoryStore.ts    # Zustand: run history (last 50), active run selection
│   │   └── useWorkflowStore.ts   # Zustand: AbortController lifecycle (startRun / abort / finishRun)
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   ├── lib/
│   │   ├── ollama.ts             # Ollama REST API client (all functions accept AbortSignal)
│   │   ├── agentFs.ts            # Agent folder reader/writer (Tauri FS)
│   │   ├── router.ts             # Agent routing (keyword → semantic embeddings → LLM fallback)
│   │   ├── embeddings.ts         # Embedding cache (nomic-embed-text via Ollama)
│   │   ├── workflowRunner.ts     # Agent chain executor (abort-aware, context budgeting)
│   │   └── settings.ts           # Settings load/save via tauri-plugin-store
│   └── components/
│       ├── shared/
│       │   ├── Sidebar.tsx       # Nav + run history list + Ollama status + settings trigger
│       │   └── OllamaGate.tsx    # "Ollama not found" screen with winget install
│       ├── Settings/
│       │   └── SettingsPanel.tsx # Slide-over drawer: LLM, Agents, Routing, Appearance, Diagnostics
│       ├── ModelManager/
│       │   └── ModelManager.tsx  # Browse, download, and manage models
│       ├── AgentExplorer/
│       │   └── AgentExplorer.tsx # Navigate agent folders, view/edit agents
│       └── ChatPanel/
│           ├── ChatPanel.tsx     # Run workflows, stream output, display history
│           └── StopButton.tsx    # Floating stop button (visible only while running)
│
├── src-tauri/                    # Rust backend (Tauri v2)
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json           # App config, permissions, bundle
│   └── src/
│       ├── main.rs
│       └── lib.rs                # Tauri commands: check_ollama, install_ollama
│
└── agents/                       # Example agent pack (or point to your own folder)
    ├── README.md
    ├── router/
    ├── coder/
    ├── reviewer/
    └── summarizer/
```

---

## Agent System

### Concept

Every subfolder in the agents directory is a standalone **agent**. Agents are defined by `.md` files with YAML frontmatter. The workflow runner reads this metadata to determine execution order, context passing, and model selection — automatically.

```
User Prompt
    ↓
Router  →  selects best-matching agent based on triggers + embeddings + LLM scoring
    ↓
Agent A  →  executes, produces structured output
    ↓
Agent B  →  receives context + output, executes next step
    ↓
…  →  chain ends when no next_agents are defined or output signals completion
```

### File Schema

#### `persona.md` *(required)*

Defines the agent's identity, capabilities, and routing metadata.

```markdown
---
name: Coder
description: Writes clean TypeScript/React code from requirements
model: qwen2.5-coder:7b
triggers:
  - "write code"
  - "implement"
  - "create component"
  - "fix bug"
next_agents:
  - reviewer
context_mode: summary   # "full" | "summary" | "none"
temperature: 0.3
---

You are a senior TypeScript developer focused on React and clean architecture.

## Behavior
- Always write complete, runnable code
- Briefly explain design decisions
- Follow best practices: typing, error handling, accessibility

## Output Format
Structure every response as:
1. Brief explanation of the approach
2. Complete code block
3. Notes on possible extensions
```

#### `prompt.md` *(optional)*

Reusable prompt templates with `{{variable}}` placeholders.

```markdown
---
variables:
  - task
  - language
  - context
---

Task: {{task}}
Language/Framework: {{language}}

Context from previous step:
{{context}}

Provide a complete implementation.
```

#### `workflow.md` *(optional)*

Defines a fixed execution order — overrides the dynamic router.

```markdown
---
steps:
  - agent: router
  - agent: coder
  - agent: reviewer
  - agent: summarizer
mode: sequential   # "sequential" | "parallel" (parallel: Phase 3)
---

This workflow creates and reviews code in three steps.
```

#### `tools.md` *(planned — Phase 3)*

Defines shell commands or scripts this agent is permitted to execute.

```markdown
---
allowed_commands:
  - "python scripts/lint.py"
  - "npm run test"
timeout: 30
---

This agent may run linting and test suites.
```

### Frontmatter Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✅ | Display name of the agent |
| `description` | `string` | ✅ | Short description used for router matching |
| `model` | `string` | — | Ollama model name; falls back to app default |
| `triggers` | `string[]` | — | Keywords for trigger-based routing |
| `next_agents` | `string[]` | — | Agent IDs (folder names) to activate after this agent |
| `context_mode` | `"full" \| "summary" \| "none"` | — | How much context is forwarded (default: `summary`) |
| `temperature` | `number` | — | LLM temperature 0.0–1.0 (default: `0.7`) |
| `max_tokens` | `number` | — | Maximum output tokens (default: `2048`) |

### Routing Logic

The router selects an agent in three stages (configurable in Settings → Routing):

1. **Keyword match** — Each agent's `triggers` array is scored against the prompt. Clear matches win immediately.
2. **Semantic embeddings** — On ambiguous matches, `nomic-embed-text` computes cosine similarity between the prompt and each agent's description. Requires `Full` routing mode.
3. **LLM fallback** — On a tie or no match, the default model is asked: *"Which of these agents is best suited for: [prompt]?"*

### Routing Modes

| Mode | Stages used | When to use |
|------|-------------|-------------|
| **Full** | Keyword → Embeddings → LLM | Most accurate; requires `nomic-embed-text` |
| **Rules + LLM** | Keyword → LLM | Faster; no embedding model needed |
| **Rules only** | Keyword only | Instant; least flexible |

### Abort Behaviour

Pressing **Stop** during a run calls `AbortController.abort()`. The signal propagates through the entire call stack — `runWorkflow` → `chatStream` / `chat` → `fetch()`. The stream reader is cancelled in a `finally` block regardless of how the request ends. The interrupted step is marked `aborted` and the run is pushed to history with `status: "aborted"` and `finishedAt` set.

---

## Settings

Open via the **gear icon** (⚙) in the sidebar footer. Changes take effect immediately and persist to disk.

| Section | Setting | Description | Default |
|---------|---------|-------------|---------|
| LLM | Default model | Ollama model for agents without an explicit `model` field | — |
| LLM | Ollama base URL | API endpoint (change for remote Ollama instances) | `http://localhost:11434` |
| Agents | Agents directory | Folder scanned for agent subfolders | — |
| Routing | Routing mode | `Full` / `Rules + LLM` / `Rules only` | `Full` |
| Routing | Embedding model | Ollama model used for semantic routing | `nomic-embed-text` |
| Appearance | Theme | `Dark` / `Light` / `System` | `Dark` |
| Diagnostics | Embedding cache | In-memory vector cache size; Clear button | — |

All settings are saved to `%APPDATA%\AgentForge\settings.json` via `tauri-plugin-store`.

---

## Run History

The sidebar maintains a chronological list of runs (newest first, max 50). Each entry shows:

- **Status dot** — green (done), gold/pulsing (running), red (error), grey (aborted)
- **Prompt preview** — first 60 characters of the initial prompt
- **Time** — start time in `HH:MM` format
- **Duration** — elapsed time once finished (e.g. `18s`, `2m 4s`)
- **Agent chain** — `router → coder → reviewer` (deduplicated agent IDs)

Clicking a history entry switches the Chat Panel to display that run. History is in-memory only and resets on app restart (persistent history: Phase 4).

---

## Development

### Branch Strategy

```
main        ← stable, always deployable
feat/*      ← new features
fix/*       ← bug fixes
```

### Useful Commands

```bash
# TypeScript type check without building
pnpm type-check

# Lint
pnpm lint

# Check Rust compilation without linking
cd src-tauri && cargo check

# Rust lints and warnings
cd src-tauri && cargo clippy
```

### Adding Tauri Permissions

Permissions are defined in `src-tauri/tauri.conf.json` under `app.security.capabilities`. New Tauri plugins each require a capability file under `src-tauri/capabilities/`.

---

## Roadmap

**Phase 1 — Core**
- [x] Tauri v2 + React/TS boilerplate
- [x] Ollama REST client (list, pull with progress, delete, streaming chat)
- [x] Agent FS reader (frontmatter parsing via gray-matter)
- [x] Keyword + LLM-based router
- [x] Workflow runner with agent chaining and context budgeting
- [x] Model Manager UI
- [x] Agent Explorer UI
- [x] Chat / Run Panel UI

**Phase 2 — Stability** ✅ complete
- [x] Settings persistence (`tauri-plugin-store`)
- [x] Example agent pack (Router, Coder, Reviewer, Summarizer)
- [x] Abort signal for running workflows (end-to-end: Stop button → `AbortController` → `fetch()`)
- [x] Run history in sidebar (status, duration, agent chain, click-to-view)
- [x] `workflow.md` sequential step parser
- [x] Semantic routing via embeddings (`nomic-embed-text`)
- [x] Settings panel UI (LLM, Agents, Routing mode, Appearance, Diagnostics)

**Phase 3 — Power Features**
- [ ] Workflow graph visualization (ReactFlow)
- [ ] Inline MD editor in Agent Explorer (CodeMirror 6)
- [ ] `tools.md` shell execution (Rust command, allowlist)
- [ ] Hugging Face GGUF browser
- [ ] Parallel agent execution

**Phase 4 — Distribution**
- [ ] Persistent run history (saved to disk)
- [ ] App icon + bundle metadata
- [ ] GitHub Actions release build (`.exe` as release asset)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | Tauri v2 |
| Frontend | React 18 + TypeScript 5 |
| State management | Zustand 4 |
| Build tool | Vite 5 |
| Backend | Rust 1.77+ |
| LLM runtime | Ollama |
| MD parsing | gray-matter (frontmatter) + marked (render) |
| Tauri plugins | fs, shell, http, dialog, store |

---

## License

Private repository — all rights reserved.
