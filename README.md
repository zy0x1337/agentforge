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
```

### 4. Start the dev server

```bash
pnpm tauri:dev
```

> **Note:** The first build takes several minutes while Cargo compiles all Rust dependencies. Subsequent starts are significantly faster thanks to incremental compilation.

### 5. Frontend-only development (optional)

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
│   ├── App.tsx                   # Root component, Ollama health polling
│   ├── styles/
│   │   └── global.css            # Design tokens (CSS custom properties)
│   ├── store/
│   │   └── useAppStore.ts        # Zustand global state
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   ├── lib/
│   │   ├── ollama.ts             # Ollama REST API client
│   │   ├── agentFs.ts            # Agent folder reader/writer (Tauri FS)
│   │   ├── router.ts             # Agent routing (keyword + LLM fallback)
│   │   └── workflowRunner.ts     # Agent chain executor
│   └── components/
│       ├── shared/
│       │   ├── Sidebar.tsx       # Navigation + Ollama status indicator
│       │   └── OllamaGate.tsx    # "Ollama not found" screen
│       ├── ModelManager/
│       │   └── ModelManager.tsx  # Browse, download, and manage models
│       ├── AgentExplorer/
│       │   └── AgentExplorer.tsx # Navigate agent folders, view/edit agents
│       └── ChatPanel/
│           └── ChatPanel.tsx     # Run workflows, stream agent output
│
├── src-tauri/                    # Rust backend (Tauri v2)
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json           # App config, permissions, bundle
│   └── src/
│       ├── main.rs
│       └── lib.rs                # Tauri commands (install_ollama, etc.)
│
└── agents/                       # Example agents (or point to your own folder)
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
Router  →  selects best-matching agent based on triggers + LLM scoring
    ↓
Agent A  →  executes, produces structured output
    ↓
Agent B  →  receives context + output, executes next step
    ↓
...  →  chain ends when no next_agents are defined or output signals completion
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
mode: sequential   # "sequential" | "parallel"
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

The router selects an agent in two stages:

1. **Keyword match** — Each agent's `triggers` array is scored against the prompt. The highest-scoring agent wins.
2. **LLM fallback** — On a tie or no match, the default model is asked: *"Which of these agents is best suited for: [prompt]?"*

---

## Configuration

App settings are persisted via `tauri-plugin-store`:

| Setting | Description | Default |
|---------|-------------|---------|
| `defaultModel` | Ollama model used by agents without an explicit `model` field | — |
| `agentsDir` | Absolute path to the agents directory | — |
| `ollamaBaseUrl` | Ollama API endpoint | `http://localhost:11434` |

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

**Phase 1 — Core (done)**
- [x] Tauri v2 + React/TS boilerplate
- [x] Ollama REST client (list, pull with progress, delete, streaming chat)
- [x] Agent FS reader (frontmatter parsing via gray-matter)
- [x] Keyword + LLM-based router
- [x] Workflow runner with agent chaining
- [x] Model Manager UI
- [x] Agent Explorer UI
- [x] Chat / Run Panel UI

**Phase 2 — Stability**
- [ ] Settings persistence (`tauri-plugin-store`)
- [ ] Example agent pack (Router, Coder, Reviewer, Summarizer)
- [ ] Semantic routing via embeddings (`nomic-embed-text`)
- [ ] `workflow.md` sequential step parser
- [ ] Abort signal for running workflows
- [ ] Run history in sidebar

**Phase 3 — Power Features**
- [ ] Workflow graph visualization (ReactFlow)
- [ ] Inline MD editor in Agent Explorer (CodeMirror 6)
- [ ] `tools.md` shell execution (Rust command, allowlist)
- [ ] Hugging Face GGUF browser

**Phase 4 — Distribution**
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
| Tauri plugins | fs, shell, http, dialog |

---

## License

Private repository — all rights reserved.
