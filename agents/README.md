# Example Agent Pack

This directory contains four starter agents that demonstrate AgentForge's routing and chaining system. Use them as-is or as templates for your own agents.

## Agents

| Agent | Model | Role | Chains to |
|-------|-------|------|-----------|
| `router` | llama3.2:3b | Reads the user prompt and delegates to the right agent | *(dynamic)* |
| `coder` | qwen2.5-coder:7b | Writes clean, typed, production-ready code | `reviewer` |
| `reviewer` | llama3.1:8b | Reviews code for bugs, security, and quality | `summarizer` |
| `summarizer` | llama3.2:3b | Condenses workflow output or long text into structured summaries | *(end)* |

## Default Workflow

When you enter a coding prompt in the Run panel, the default chain is:

```
User Prompt  →  Router  →  Coder  →  Reviewer  →  Summarizer
```

1. **Router** reads the prompt and picks the first agent (`coder` for code tasks)
2. **Coder** implements the solution
3. **Reviewer** checks the code and flags issues
4. **Summarizer** produces a final digest of the full workflow output

## Using Your Own Agents Folder

Point AgentForge to any directory on your machine via **Agent Explorer → Open Agents Folder**. The app recursively reads every subfolder that contains a `persona.md` file. This folder is just the bundled example — your agents live wherever you prefer.

## Creating a New Agent

1. Create a subfolder with a short, lowercase name (e.g. `agents/translator/`)
2. Add a `persona.md` with valid YAML frontmatter (see [Agent Schema](../README.md#file-schema))
3. Optionally add `prompt.md` and/or `workflow.md`
4. The app picks it up automatically on next load or folder refresh
