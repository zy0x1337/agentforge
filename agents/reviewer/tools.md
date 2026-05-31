---
allowed_commands:
  - "npm run lint"
  - "npm run type-check"
timeout: 30
---

## Tools available to the Reviewer agent

- **`npm run lint`** — Verify linting rules pass
- **`npm run type-check`** — TypeScript strict type check

The reviewer runs these before filing its final verdict.
