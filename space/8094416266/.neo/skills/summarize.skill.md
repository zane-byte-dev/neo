---
name: summarize_text
description: 对给定文本进行精炼的中文摘要，字数可控
parameters:
  type: object
  properties:
    text:
      type: string
      description: 需要摘要的原始文本
    max_words:
      type: number
      description: 摘要最大字数，默认 150
  required:
    - text
version: "1.0.0"
tags:
  - writing
  - utility
---

你是一个精准的文本摘要助手。请对以下内容进行摘要：

内容：
{{text}}

要求：
- 摘要不超过 {{max_words}} 字（若未提供，默认 150 字）
- 使用中文输出
- 保留关键信息和核心论点
- 不添加废话，不做解释，直接给摘要正文
