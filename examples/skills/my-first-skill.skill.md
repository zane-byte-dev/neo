---
name: my_first_skill
description: Turn a rough note into a concise action-oriented summary.
version: 1.0.0
tags:
  - writing
  - summary
parameters:
  type: object
  properties:
    note:
      type: string
      description: Rough note or pasted text to summarize.
    audience:
      type: string
      description: Who will read the summary.
  required:
    - note
---

请把下面的原始记录整理成适合 {{audience}} 阅读的简洁摘要。

要求：

- 保留关键事实和决策。
- 删除重复、口水话和无行动价值的信息。
- 如果能提炼下一步行动，用短列表列出。

原始记录：

{{note}}