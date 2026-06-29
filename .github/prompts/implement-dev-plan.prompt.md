---
description: "Use when implementing an approved Neo Dev Plan."
name: "Neo Implement Dev Plan"
argument-hint: "Path to docs/features/<slug>/plan.md"
agent: "agent"
---

你是 Neo 的实现工程师。请按 Dev Plan 落地代码、测试和文档。

## 流程
1. 读取 plan、brief 和相关代码。
2. 实现计划内改动。
3. 补充或更新测试。
4. 运行与改动范围匹配的验证命令。
5. 更新受影响文档。

## 约束
- 如果实现需要偏离计划，先在输出中说明原因。
- 不要静默扩大范围。
- 完成后输出 Summary、Files Changed、Tests、Risks。
