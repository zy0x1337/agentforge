# AgentForge

> Browse and download local open-source LLMs, then orchestrate them into automated agent workflows — a native desktop app for **Windows, macOS and Linux**.

AgentForge is built on **Tauri v2 + React/TypeScript** and uses [Ollama](https://ollama.com) as the local LLM backend. Folders containing `.md` files define self-contained **agents** that can activate each other, pass context forward, and automatically decompose complex tasks into sequential or parallel steps.

![License](https://img.shields.io/badge/license-MIT-green) ![CI](https://img.shields.io/github/actions/workflow/status/zy0x1337/agentforge/ci.yml?branch=main&label=CI) ![Release](https://img.shields.io/github/v/release/zy0x1337/agentforge?include_prereleases&display_name=tag&label=Release) ![Tauri](https://img.shields.io/badge/Tauri-v2-blue) ![React](https://img.shields.io/badge/React-18-61dafb) ![Rust](https://img.shields.io/badge/Rust-1.77%2B-orange)

---

## Features

- **Model Manager** — View installed models, download popular ones with a single click via Ollama, pull any custom model by name, and set a default model for the app
- **Hugging Face GGUF Browser** — Search public HF repositories, filter by provider (bartowski, TheBloke, lmstudio-community, unsloth), sort by quant tag / size / VRAM estimate, download directly to a user-selected folder, and one-click import into Ollama
- **Quant Metadata** — Every GGUF file shows its quantisation tag (Q4_K_M, Q6_K, IQ4_XS, …), quality tier, bits-per-weight, and estimated VRAM requirement
- **Agent Explorer** — Open any folder as an agents directory; every subfolder becomes an agent defined by `.md` files with YAML frontmatter
- **Inline MD Editor** — CodeMirror 6 split-pane editor: syntax-highlighted markdown + YAML, live preview, structured Frontmatter Panel, dirty state (`●`), `Ctrl+S` to save, per-tab revert
- **Workflow Runner** — Enter a prompt; the router selects the best-matching agent, executes it, and passes structured output to the next agent in the chain
- **Parallel Agent Execution** — `workflow.md` steps with `mode: parallel` fan out to multiple agents concurrently via `Promise.allSettled`; results merged via `concat`, `summarise`, or `vote` strategy before the next sequential step
- **Workflow Graph** — ReactFlow canvas that visualises the agent topology in real time (animated edges, per-node status) and as a static dependency map when idle
- **Streaming UI** — Every agent step streams output live as a chat bubble
- **Abort / Stop** — Cancel a running workflow at any point; `AbortController` signal propagates through all in-flight parallel streams simultaneously
- **Run History** — Every completed or aborted run is persisted to disk and shown in a sidebar; clicking an entry re-opens the Graph panel for that run
- **Settings Panel** — Slide-over drawer: LLM, Agents, Routing mode, Appearance, Diagnostics. All changes persist immediately
- **Persistent Settings** — Default model, agents directory, Ollama base URL, theme, embedding model, and routing mode saved via `tauri-plugin-store`
- **Ollama Gate** — Detects whether Ollama is running; if not, offers guided installation instructions

---

## Installation

### Download (recommended)

1. Go to the [**Releases**](https://github.com/zy0x1337/agentforge/releases) page
2. Download the installer for your platform:

| Platform | File |
|---|---|
| Windows x64 | `AgentForge_*_x64-setup.exe` (NSIS — recommended) |
| Windows x64 | `AgentForge_*_x64.msi` (MSI — enterprise / GPO) |
| macOS Apple Silicon | `AgentForge_*_aarch64.dmg` |
| macOS Intel | `AgentForge_*_x64.dmg` |
| Linux x64 | `AgentForge_*_amd64.AppImage` (no install needed) |
| Linux x64 | `AgentForge_*_amd64.deb` (Debian / Ubuntu) |

3. Make sure [Ollama](https://ollama.com/download) is installed and running
4. On first launch, follow the **Setup** instructions below

> **SHA-256 checksums** for every release asset are attached as `checksums.txt`.

### Build from source

See [Getting Started](#getting-started) below.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------| 
| **Node.js** | ≥ 20 | [nodejs.org](https://nodejs.org) |
| **pnpm** | ≥ 9 | `npm i -g pnpm` |
| **Rust** (stable) | ≥ 1.77 | [rustup.rs](https://rustup.rs) |
| **Ollama** | latest | [ollama.com/download](https://ollama.com/download) |

**Platform-specific:**
- **Windows** — Rust requires the Visual C++ Build Tools. Install via [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select **"Desktop development with C++"**. WebView2 is pre-installed on Windows 10 22H2+ / Windows 11.
- **macOS** — Xcode Command Line Tools: `xcode-select --install`
- **Linux** — Install WebKit2GTK and build tools: `sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

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
| **Agents directory** | Absolute path to a folder with agent subfolders |
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

Output in `src-tauri/target/release/bundle/`.

---

## CI / CD

All pipelines live in [`.github/workflows/`](.github/workflows/).

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **CI** (`ci.yml`) | Every PR + push to `main` | `pnpm type-check` + `pnpm lint` on ubuntu-latest |
| **Release** (`release.yml`) | `git push origin v*.*.*` | Cross-platform matrix build → Windows (NSIS + MSI), macOS (DMG × 2), Linux (AppImage + deb) → GitHub Release + `checksums.txt` |
| **Icon Generator** (`icon-gen.yml`) | `icon.svg` changed on `main` | Regenerates all PNG/ICO/ICNS rasters and commits them back |

**Dependabot** runs every Monday at 09:00 CET and opens grouped PRs for GitHub Actions, npm, and Cargo updates.

### Creating a release

```bash
# Bump version in tauri.conf.json + Cargo.toml + package.json first, then:
git tag v0.2.0
git push origin v0.2.0
# → GitHub Actions builds all platform installers and creates the release automatically
```

Pre-release tags (e.g. `v0.2.0-beta.1`) are automatically marked as pre-releases on GitHub.

### Signing key setup (one-time)

Required before the first `git tag` push. Store both values as repository secrets:

```bash
# Generate key pair
npx @tauri-apps/cli signer generate -w ~/.tauri/agentforge.key

# Base64-encode the private key
base64 -w 0 ~/.tauri/agentforge.key   # Linux / macOS / WSL
# → GitHub → Settings → Secrets → Actions:
#   TAURI_SIGNING_PRIVATE_KEY         ← paste the base64 output
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD ← passphrase (empty string OK for dev)
```

> `GITHUB_TOKEN` is injected automatically — no manual secret needed.

---

## Project Structure

```
agentforge/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── release.yml
│   │   └── icon-gen.yml
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
│
├── LICENSE
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
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
│   │   ├── workflowRunner.ts
│   │   ├── parallelRunner.ts
│   │   ├── graphLayout.ts
│   │   ├── hfHub.ts
│   │   ├── quantParser.ts
│   │   ├── providers.ts
│   │   ├── modelDownloader.ts
│   │   ├── modelSort.ts
│   │   ├── historyPersist.ts
│   │   └── settings.ts
│   └── components/
│       ├── shared/
│       ├── Settings/
│       ├── ModelManager/
│       ├── HfGgufBrowser/
│       ├── AgentExplorer/
│       ├── AgentEditor/
│       ├── WorkflowGraph/
│       ├── HistorySidebar/
│       └── ChatPanel/
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       └── commands/
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

### Provider badges

| Provider | Speciality |
|---|---|
| **bartowski** | IQ variants, frequently updated — ✓ recommended |
| **TheBloke** | Largest catalogue, legacy formats — ✓ recommended |
| **lmstudio-community** | Optimised for llama.cpp / LM Studio — ✓ recommended |
| **unsloth** | Dynamic quants (DQ), fine-tunes — ✓ recommended |

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
next_agents:
  - reviewer
context_mode: summary
temperature: 0.3
max_tokens: 4096
---

You are a senior TypeScript developer…
```

#### `workflow.md`

```markdown
---
steps:
  - agent: router
  - agents: [coder, researcher]
    mode: parallel
    merge_strategy: concat
    timeout_ms: 90000
  - agent: reviewer
  - agent: summarizer
---
```

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

---

## Parallel Execution

When `workflowRunner.ts` encounters a step with `mode: parallel`, it delegates to `parallelRunner.ts`. All listed agents launch simultaneously via `Promise.allSettled`.

### Merge strategies

| Strategy | Behaviour | Best for |
|---|---|---|
| `concat` *(default)* | Outputs appended in declaration order | Code + docs, multi-section reports |
| `summarise` | LLM call condenses all results | Long parallel outputs |
| `vote` | Agents return `{ choice, reason }` JSON; majority wins | Classification, decision tasks |

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

**Phase 1–3 — Core, Stability, Power Features** ✅ Complete

**Phase 4 — Distribution** *(in progress)*
- [x] LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, Issue/PR templates
- [x] GitHub Actions: CI, cross-platform release matrix (Windows/macOS/Linux), icon generator
- [x] Dependabot
- [ ] Auto-updater (`tauri-plugin-updater`)
- [ ] Onboarding wizard

**Phase 5 — Testing & Robustness** *(planned)*
- [ ] Vitest unit tests: `parallelRunner`, `router`, `workflowParser`
- [ ] Playwright E2E smoke tests
- [ ] CSS Modules migration (remove inline styles from `App.tsx`)
- [ ] Split `embeddings.ts` — cache layer separate from similarity

**Phase 6 — Features** *(planned)*
- [ ] OpenAI-compatible API provider
- [ ] Visual Workflow Builder (drag-and-drop in graph)
- [ ] Agent Marketplace
- [ ] RAG integration (local vector DB)
- [ ] Plugin system

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch conventions, commit format, and the PR process.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md) v2.1.

## License

MIT — see [LICENSE](LICENSE).
