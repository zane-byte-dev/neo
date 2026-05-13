# Skills 开发指南

Skill 是一个 Markdown 文件：frontmatter 定义名称、描述和参数，正文定义可复用提示词。Neo 会从 `{stateDir}/skills/` 加载 Skill，并通过 `run_skill` 工具执行。

## 通过对话沉淀 Skill

除了在 Settings / Skills 里手动创建和编辑，你也可以直接在对话里让 Neo 把当前对话沉淀成一个可复用 Skill。

推荐说法：

- “把我们刚才这套回复套路保存成一个 skill，名字叫 `brief_reply`。”
- “根据当前对话生成一个可复用的审校 skill，下次我只要提供原文就能直接调用。”

Neo 会通过内置的 `manage_skill` 工具把 Skill 写入 `{stateDir}/skills/`。保存成功后：

- 当前会话里可立刻通过 `list_skills` 看到它。
- 后续对话可直接调用 `run_skill` 复用。
- Settings / Skills 页面也会显示同一份 Skill 文件。

## 文件位置

支持两种布局：

```text
{stateDir}/skills/
├── summarize_text.skill.md
└── xifeng/
    └── skill.md
```

文件必须包含 YAML frontmatter，否则不会注册。

## 基本格式

```markdown
---
name: summarize_text
description: Summarize long text into concise bullet points.
version: 1.0.0
tags:
  - writing
parameters:
  type: object
  properties:
    text:
      type: string
      description: Text to summarize.
    audience:
      type: string
      description: Intended audience.
  required:
    - text
---

请把下面的内容总结给 {{audience}} 阅读：

{{text}}
```

frontmatter 字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | Skill 名称，供 `run_skill` 调用 |
| `description` | 是 | 给模型看的能力说明 |
| `parameters` | 否 | JSON Schema 风格参数声明 |
| `version` | 否 | 版本号，便于维护 |
| `tags` | 否 | 标签列表 |
| `enabled` | 否 | 设为 `false` 时跳过注册 |

## 参数插值

正文和可执行代码块都支持 `{{param_name}}` 插值。调用时缺失 required 参数会直接返回错误；未知占位符会保留原样。

## 执行模式

### Prompt 模式

没有 `execute` 代码块时，Neo 会把插值后的正文作为系统指令，再启动一次带工具能力的 LLM 调用。适合写作、总结、审校、研究流程等任务。

### 可执行代码块模式

如果正文中存在 ` ```js execute `、` ```python execute `、` ```bash execute ` 等代码块，Neo 会执行第一个可执行代码块，并返回 stdout / stderr。支持语言包括 `js`、`ts`、`python`、`bash` / `sh`。

````markdown
```python execute
print("Hello, {{name}}")
```
````

可执行代码块会经过危险模式检查，并有 30 秒超时限制。它适合小型转换、计算和格式化任务；涉及文件系统或外部服务时，优先写成自定义工具。

## 最小示例

可直接复制 [examples/skills/my-first-skill.skill.md](../../examples/skills/my-first-skill.skill.md) 到 `{stateDir}/skills/`，然后让 Agent 调用 `run_skill`。

如果你希望 Neo 直接基于一段已经完成的对话生成 Skill，优先在提示里说明这 4 件事：

- 这个 Skill 的用途
- 想要的 Skill 名称
- 未来调用时希望传入哪些参数
- 输出应该长什么样

修改 Skill 后调用 `/api/reload` 或重启后端，让注册表重新加载。