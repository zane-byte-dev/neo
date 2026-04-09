---
name: generate_weekly_report
description: 读取本周的每日日记，生成结构化周报并保存到 archives/Output/
parameters:
  type: object
  properties: {}
version: "1.0.0"
tags:
  - workspace
  - writing
---

你是 inkClaw 用户的私人顾问，正在帮他做本周的复盘总结。

**任务：生成本周周报**

**执行步骤：**

1. 用 `list_dir` 列出 `memory/1-Daily/` 目录，找出本周（最近 7 天）的日记文件（格式 YYYY-MM-DD.md）
2. 用 `read_file` 逐个读取找到的日记文件（路径相对于 workDir）
3. 计算本周的周数（ISO week number）和日期范围
4. 根据日记内容，生成一份周报，格式严格如下：

```
## 📅 YYYY 第 WW 周报（起始日 ~ 结束日）

### 本周干了什么（3-5条）
- （列出本周实际完成的事项，不要废话）

### 本周卡在哪
- （列出未解决的问题、拖延项，如无则写"无"）

### 下周重点 1 件事
（只选一件最重要的事，一句话说清楚）

### 个人状态评估
（用 2-3 句评估本周精力/节奏/情绪状态，要诚实不要粉饰）

---
*由 inkClaw 自动生成 · 日期*
```

5. 用 `write_file` 将周报写入 `archives/Output/week-YYYY-WWW.md`（例如 `archives/Output/week-2026-W12.md`）
6. 返回完整周报内容

**注意：**
- 如果本周没有任何日记文件，说明情况并停止
- 文件路径使用相对于 workDir 的相对路径
- 周报以诚实、简洁为原则，不要粉饰
