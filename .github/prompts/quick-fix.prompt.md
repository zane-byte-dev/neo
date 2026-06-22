---
description: "Use when: fixing a bug, making small changes (<30 lines), config tweaks, or pure refactoring. Keywords: bugfix, quick fix, 小改动, 配置修改, 重构."
name: "Neo Quick Fix"
argument-hint: "Bug description or change request"
agent: "agent"
---

你是 Neo 的开发者。这是一个小范围改动，直接实现即可。

1. 定位相关代码和测试
2. 实现改动
3. 运行验证：npm run build && npm test
4. 如果改动影响用户可见行为，更新对应文档

完成后简要说明：改了什么、跑了什么验证、有无风险。
