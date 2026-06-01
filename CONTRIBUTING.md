# Contributing to AgentForge

Thank you for considering a contribution! AgentForge is an MIT-licensed open-source project and welcomes all kinds of contributions — bug reports, feature ideas, documentation improvements, and code.

## Table of Contents

- [Getting Started](#getting-started)
- [Branch Convention](#branch-convention)
- [Commit Format](#commit-format)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Running Tests](#running-tests)
- [Reporting Bugs](#reporting-bugs)

---

## Getting Started

```bash
# Prerequisites: Node 24+, pnpm, Rust (stable), Tauri CLI v2
git clone https://github.com/zy0x1337/agentforge.git
cd agentforge
pnpm install
pnpm tauri:dev
```

See the [README](./README.md) for full setup instructions.

---

## Branch Convention

| Prefix | Purpose | Example |
|---|---|---|
| `feat/` | New feature | `feat/openai-provider` |
| `fix/` | Bug fix | `fix/router-semantic-threshold` |
| `chore/` | Tooling, deps, config | `chore/update-tauri-2.1` |
| `docs/` | Documentation only | `docs/agent-frontmatter-guide` |
| `test/` | Tests only | `test/parallel-runner-unit` |
| `refactor/` | Refactor, no behaviour change | `refactor/split-embeddings` |

Branch from `main`. Keep branches focused — one concern per PR.

---

## Commit Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]
[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`, `ci`

**Scopes** (optional, use the affected module): `router`, `parallel`, `workflow`, `ui`, `store`, `tauri`, `ci`, `deps`

**Examples:**
```
feat(router): add configurable semantic threshold
fix(parallel): handle AbortSignal race on summarise merge
docs: add agent frontmatter reference to README
chore(deps): update @xyflow/react to 12.4
```

---

## Pull Request Process

1. Fork the repo and create your branch from `main`.
2. Make your changes and add/update tests where applicable.
3. Run `pnpm type-check` and `pnpm lint` — both must pass.
4. Push your branch and open a PR against `main`.
5. Fill out the PR template fully.
6. A maintainer will review within a few days. Please be patient.

**Small, focused PRs merge faster.** Large PRs covering multiple concerns will be asked to be split.

---

## Code Style

- **TypeScript strict mode** is enabled — no `any` unless absolutely justified with a comment.
- **No inline styles** in React components — use CSS modules or CSS custom properties.
- **Zustand stores** own their slice of state. Don't reach into another store's internals.
- **No circular imports** — `lib/` files must not import from `components/` or `store/`.
- ESLint is configured with `--max-warnings 0`. All warnings are errors.

---

## Running Tests

```bash
# Type checking
pnpm type-check

# Lint
pnpm lint

# Unit tests (once Vitest is set up in Phase 5)
pnpm test

# E2E (once Playwright is set up)
pnpm test:e2e
```

---

## Reporting Bugs

Use the [Bug Report issue template](.github/ISSUE_TEMPLATE/bug_report.md). Please include:
- Your OS and architecture
- AgentForge version
- Ollama version and model(s) in use
- Steps to reproduce
- Expected vs. actual behaviour

For security vulnerabilities, **do not** open a public issue. Email the maintainer directly.
