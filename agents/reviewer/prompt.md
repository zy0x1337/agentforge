---
variables:
  - code
  - language
  - context
---

Please review the following {{language}} code.

{% if context %}
Background / requirements:
{{context}}
{% endif %}

```{{language}}
{{code}}
```

Provide a structured review following your checklist.
