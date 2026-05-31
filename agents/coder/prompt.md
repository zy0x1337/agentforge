---
variables:
  - task
  - language
  - context
---

Task: {{task}}
Language / Framework: {{language}}

{% if context %}
Context from previous step:
{{context}}
{% endif %}

Provide a complete, production-ready implementation. No placeholders.
