---
allowed_commands:
  - "npm run lint"
  - "npm run type-check"
  - "npm test -- --run"
timeout: 60
---

## Tools available to the Coder agent

This agent is permitted to run the following commands to validate its own output:

- **`npm run lint`** — ESLint check on the whole project
- **`npm run type-check`** — TypeScript compiler in `noEmit` mode
- **`npm test -- --run`** — Vitest single-run (no watch)

All commands run from the project root. Output is streamed live in the Tools panel.
