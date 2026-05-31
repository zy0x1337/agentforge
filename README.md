# AgentForge

> Lokale Open-Source LLMs browsen, herunterladen und in automatisierte Agent-Workflows orchestrieren — als native Windows-App.

AgentForge ist eine Desktop-Applikation auf Basis von **Tauri v2 + React/TypeScript**, die [Ollama](https://ollama.com) als lokales LLM-Backend nutzt. Ordner mit `.md`-Dateien definieren eigenständige **Agents**, die sich gegenseitig aktivieren, Kontext weitergeben und komplexe Aufgaben automatisch in Schritte aufteilen können.

---

## Features

- **Model Manager** — Installierte Modelle anzeigen, populäre Modelle mit einem Klick herunterladen (via Ollama), Custom-Modell-Namen pullen, Default-Modell festlegen
- **Agent Explorer** — Beliebigen Ordner als Agents-Verzeichnis öffnen; jeder Unterordner ist ein Agent, definiert durch `.md`-Dateien mit YAML-Frontmatter
- **Workflow Runner** — Einen Prompt eingeben; der Router-Agent bestimmt den passendsten Agent, führt ihn aus, gibt den strukturierten Output an den nächsten Agent weiter
- **Streaming UI** — Jeder Agent-Step wird live gestreamt und als Chat-Bubble dargestellt
- **Ollama Gate** — Automatische Erkennung ob Ollama läuft; bei Bedarf Installation via `winget` anstoßen

---

## Voraussetzungen

| Tool | Version | Link |
|------|---------|------|
| **Node.js** | ≥ 20 | [nodejs.org](https://nodejs.org) |
| **pnpm** | ≥ 9 | `npm i -g pnpm` |
| **Rust** | ≥ 1.77 (stable) | [rustup.rs](https://rustup.rs) |
| **Tauri CLI** | v2 (via devDep) | — |
| **Ollama** | aktuell | [ollama.com/download](https://ollama.com/download) |
| **WebView2** | vorinstalliert ab Win10 22H2 | [microsoft.com/edge/webview2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |

> **Hinweis Windows:** Visual C++ Build Tools werden von Rust benötigt. Am einfachsten via [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/) → "Desktop development with C++" aktivieren.

---

## Setup & Entwicklung

### 1. Repository klonen

```bash
git clone https://github.com/zy0x1337/agentforge.git
cd agentforge
```

### 2. Node-Dependencies installieren

```bash
pnpm install
```

### 3. Ollama starten

```bash
# Ollama muss im Hintergrund laufen (startet automatisch nach Installation)
ollama serve

# Mindestens ein Modell herunterladen (z.B. für schnelle Tests)
ollama pull llama3.2:3b
```

### 4. Dev-Server starten

```bash
pnpm tauri:dev
```

Der erste Start dauert mehrere Minuten, da Cargo alle Rust-Abhängigkeiten kompiliert. Folgestarts sind deutlich schneller dank Incremental Compilation.

### 5. (Optional) Nur Frontend entwickeln

```bash
pnpm dev
# → http://localhost:1420
```

Ohne Tauri-Kontext fehlen FS-Zugriff und Shell-Befehle. Für reine UI-Arbeit ausreichend.

---

## Produktions-Build

```bash
pnpm tauri:build
```

Erzeugt unter `src-tauri/target/release/bundle/`:
- `agentforge_0.1.0_x64-setup.exe` — NSIS-Installer
- `agentforge_0.1.0_x64.msi` — MSI-Paket

> Release-Profile sind auf minimale Größe optimiert (`opt-level = "s"`, LTO, Strip).

---

## Projektstruktur

```
agentforge/
├── index.html                    # Tauri WebView Entry
├── vite.config.ts
├── package.json
├── tsconfig.json
│
├── src/                          # React + TypeScript Frontend
│   ├── main.tsx                  # ReactDOM Entry
│   ├── App.tsx                   # Root-Komponente, Ollama-Polling
│   ├── styles/
│   │   └── global.css            # Design Tokens (CSS Custom Properties)
│   ├── store/
│   │   └── useAppStore.ts        # Zustand Global State
│   ├── types/
│   │   └── index.ts              # TypeScript Interfaces
│   ├── lib/
│   │   ├── ollama.ts             # Ollama REST-API Client
│   │   ├── agentFs.ts            # Agent-Ordner lesen/schreiben (Tauri FS)
│   │   ├── router.ts             # Agent-Routing (Keyword + LLM-Fallback)
│   │   └── workflowRunner.ts     # Agent-Chain-Executor
│   └── components/
│       ├── shared/
│       │   ├── Sidebar.tsx       # Navigation + Ollama-Status
│       │   └── OllamaGate.tsx    # "Ollama nicht gefunden"-Screen
│       ├── ModelManager/
│       │   └── ModelManager.tsx  # Modelle verwalten + herunterladen
│       ├── AgentExplorer/
│       │   └── AgentExplorer.tsx # Agent-Ordner navigieren + editieren
│       └── ChatPanel/
│           └── ChatPanel.tsx     # Workflow ausführen + Ergebnis streamen
│
├── src-tauri/                    # Rust Backend (Tauri v2)
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json           # App-Konfiguration, Permissions
│   └── src/
│       ├── main.rs
│       └── lib.rs                # Tauri Commands (install_ollama, etc.)
│
└── agents/                       # Beispiel-Agents (eigener Ordner empfohlen)
    ├── router/
    ├── coder/
    ├── reviewer/
    └── summarizer/
```

---

## Agent-System

### Konzept

Jeder Unterordner im Agents-Verzeichnis ist ein eigenständiger **Agent**. Ein Agent wird durch `.md`-Dateien mit YAML-Frontmatter definiert. Der Workflow-Runner liest diese Metadaten und orchestriert automatisch die Ausführungsreihenfolge.

### Datei-Schema

#### `persona.md` *(Pflicht)*

Definiert die Identität, Fähigkeiten und Routing-Metadaten des Agents.

```markdown
---
name: Coder
description: Schreibt sauberen TypeScript/React Code basierend auf Anforderungen
model: qwen2.5-coder:7b
triggers:
  - "schreib code"
  - "implementiere"
  - "erstelle komponente"
  - "fix bug"
next_agents:
  - reviewer
context_mode: summary   # "full" | "summary" | "none"
temperature: 0.3
---

Du bist ein erfahrener Senior TypeScript Developer mit Fokus auf React und saubere Architektur.

## Verhalten
- Schreibe immer vollständige, lauffähige Code-Snippets
- Erkläre deine Designentscheidungen kurz
- Beachte Best Practices (Typing, Error Handling, Accessibility)

## Output-Format
Strukturiere deinen Output immer als:
1. Kurze Erklärung des Ansatzes
2. Vollständiger Code-Block
3. Hinweise auf mögliche Erweiterungen
```

#### `prompt.md` *(Optional)*

Wiederverwendbare Prompt-Templates mit `{{variable}}`-Platzhaltern.

```markdown
---
variables:
  - task
  - language
  - context
---

Aufgabe: {{task}}
Sprache/Framework: {{language}}

Kontext aus vorherigem Schritt:
{{context}}

Bitte liefere eine vollständige Implementierung.
```

#### `workflow.md` *(Optional)*

Definiert eine feste Ausführungsreihenfolge — überschreibt das dynamische Routing des Routers.

```markdown
---
steps:
  - agent: router
  - agent: coder
  - agent: reviewer
  - agent: summarizer
mode: sequential   # "sequential" | "parallel"
---

Dieser Workflow erstellt und reviewed Code in drei Schritten.
```

#### `tools.md` *(Geplant — Phase 3)*

Definiert Shell-Befehle oder Skripte, die dieser Agent ausführen darf.

```markdown
---
allowed_commands:
  - "python scripts/lint.py"
  - "npm run test"
timeout: 30
---

Dieser Agent darf Linting und Tests ausführen.
```

### Frontmatter-Referenz

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|--------------|
| `name` | `string` | ✅ | Anzeigename des Agents |
| `description` | `string` | ✅ | Kurzbeschreibung (für Router-Matching) |
| `model` | `string` | — | Ollama-Modellname; Fallback: Default-Modell der App |
| `triggers` | `string[]` | — | Keywords für Keyword-Routing |
| `next_agents` | `string[]` | — | Agent-IDs (Ordnernamen) die nach diesem aktiviert werden |
| `context_mode` | `"full" \| "summary" \| "none"` | — | Wie viel Kontext weitergegeben wird (Standard: `summary`) |
| `temperature` | `number` | — | LLM-Temperatur 0.0–1.0 (Standard: 0.7) |
| `max_tokens` | `number` | — | Maximale Output-Token (Standard: 2048) |

### Routing-Logik

Der Router bestimmt in zwei Stufen welcher Agent für einen Prompt zuständig ist:

1. **Keyword-Match** — `triggers` aller Agents werden gegen den Prompt gescored. Der Agent mit dem höchsten Score gewinnt.
2. **LLM-Fallback** — Bei Gleichstand oder keinem Match wird das Default-Modell befragt: *"Welcher dieser Agents ist am besten geeignet für: [prompt]?"*

---

## Konfiguration

Die App-Einstellungen werden persistent über `tauri-plugin-store` gespeichert:

| Einstellung | Beschreibung | Standard |
|-------------|--------------|---------|
| `defaultModel` | Ollama-Modell für alle Agents ohne eigenes `model`-Feld | — |
| `agentsDir` | Absoluter Pfad zum Agents-Verzeichnis | — |
| `ollamaBaseUrl` | Ollama API Endpoint | `http://localhost:11434` |

---

## Entwicklungs-Workflow

### Branches

```
main          ← stable, immer deployable
feat/*        ← neue Features
fix/*         ← Bugfixes
```

### Nützliche Commands

```bash
# TypeScript type-check ohne Build
pnpm type-check

# Linting
pnpm lint

# Nur Rust kompilieren (ohne Frontend)
cd src-tauri && cargo check

# Rust-Warnungen anzeigen
cd src-tauri && cargo clippy
```

### Tauri-Permissions anpassen

Berechtigungen werden in `src-tauri/tauri.conf.json` unter `app.security.capabilities` definiert. Für neue Tauri-Plugins muss jeweils eine Capability-Datei unter `src-tauri/capabilities/` erstellt werden.

---

## Roadmap

- [x] Tauri v2 + React/TS Boilerplate
- [x] Ollama REST-API Client (list, pull mit Progress, delete, chat mit Streaming)
- [x] Agent-FS-Reader (Frontmatter-Parsing via gray-matter)
- [x] Keyword + LLM-basierter Router
- [x] Workflow-Runner mit Agent-Chaining
- [x] Model Manager UI
- [x] Agent Explorer UI
- [x] Chat/Run Panel UI
- [ ] Settings-Persistenz (`tauri-plugin-store`)
- [ ] Beispiel-Agent-Pack (Router, Coder, Reviewer, Summarizer)
- [ ] Semantisches Routing via Embeddings (`nomic-embed-text`)
- [ ] `workflow.md` sequenzieller Step-Parser
- [ ] Workflow-Graph-Visualisierung (ReactFlow)
- [ ] MD-Editor im Agent Explorer (CodeMirror 6)
- [ ] `tools.md` Shell-Execution (Rust-Command, Allowlist)
- [ ] Hugging Face GGUF-Browser
- [ ] GitHub Actions Release-Build

---

## Tech Stack

| Schicht | Technologie |
|---------|------------|
| Desktop-Framework | Tauri v2 |
| Frontend | React 18 + TypeScript 5 |
| State | Zustand 4 |
| Build | Vite 5 |
| Backend | Rust 1.77+ |
| LLM-Runtime | Ollama |
| MD-Parsing | gray-matter (Frontmatter) + marked (Render) |
| Tauri Plugins | fs, shell, http, dialog |

---

## Lizenz

Privates Repository — alle Rechte vorbehalten.
