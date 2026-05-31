---
variables:
  - content
  - format
---

Please summarize the following content.
{% if format %}Output format preference: {{format}}{% endif %}

---

{{content}}

---

Provide a clear, structured summary.
