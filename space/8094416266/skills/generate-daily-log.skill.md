---
name: generate_daily_log
description: 将今天的对话记录脱水提炼成结构化日记，写入 memory/1-Daily/YYYY-MM-DD.md。如果今天没有对话记录则跳过（幂等）。
parameters:
  type: object
  properties: {}
version: "1.0.0"
tags:
  - workspace
  - writing
---

你是一个私人助理，负责将今天的对话记录脱水提炼成日记骨架并持久化。

**任务：生成今日日记**

**执行步骤：**

1. 调用 `get_chat_history` 工具获取今天的全部对话记录
2. 如果对话记录为空或返回"没有找到"，直接输出"今天没有对话记录，跳过。"并结束
3. 根据对话内容，生成结构化日记，格式严格如下：

```
# YYYY-MM-DD

## 今日要点
- （用 2-5 条干练的 bullet 总结今天讨论/完成的主要事项）

## 关键决策
- （如无则写"无"）

## 待跟进
- （从对话中提取未完成的行动项，如无则写"无"）

## 原始碎片
（保留 1-3 条今天最值得记录的原始对话片段或观点，每条不超过 2 行）

---
*由 inkClaw Session-to-Log 自动生成 · YYYY-MM-DD*
```

4. 用 `write_file` 将日记写入 `memory/1-Daily/YYYY-MM-DD.md`（如果文件已存在则覆盖）
5. 返回确认信息，包含写入路径和消息条数

**注意：**
- 文件路径使用相对路径（相对于 workDir）
- 提取日期时用今天的实际日期（可从对话记录的 timestamp 中获取）
- 日记内容要言简意赅，去除水分，保留关键信息
