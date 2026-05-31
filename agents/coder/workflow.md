---
steps:
  - agent: coder
    context_mode: none
    temperature: 0.3
  - agent: reviewer
    context_mode: full
    temperature: 0.2
    condition: "previous_output contains 'function'"
  - agent: summarizer
    context_mode: summary
    temperature: 0.5
mode: sequential
on_error: continue
description: "Write, review, and summarize code end-to-end."
---

This workflow takes a coding task, implements it via the Coder agent,
passes the full output to the Reviewer (only if the output contains actual
code), then produces a concise summary of what was built.
