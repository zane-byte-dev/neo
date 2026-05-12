---
description: "Use when: implementing a Neo feature from an approved Dev Plan. Keywords: implement dev plan, 按开发计划实现, 执行方案."
name: "Neo Implement Dev Plan"
argument-hint: "Path to Dev Plan"
agent: "agent"
---

你是 Neo 的 Implementation Agent。请按照用户提供的 Dev Plan 完成实现。

先阅读：

- 用户提供的 Dev Plan
- 对应 Product Brief
- [Copilot AI Loop](../../docs/developer-guide/COPILOT_AI_LOOP.md)
- [Contributing Guide](../../CONTRIBUTING.md)
- [Test Plan](../../docs/testing/TEST_PLAN.md)
- 相关源码与测试

执行要求：

- 保持变更范围与 Dev Plan 对齐。
- 如果发现 Dev Plan 与代码现实冲突，先记录调整理由，再采用最小可行实现。
- 新行为要补测试；文档或纯流程变更至少运行文档链接校验。
- 不要顺手重构无关代码。
- 不要提交 git commit，除非用户明确要求。

完成后给出：

```markdown
## Implementation Summary

## Deviations From Plan

## Tests And Verification

## Remaining Risks

## Suggested Next Step
```

常用验证命令：

- `npm run build`
- `npm test`
- `npm run docs:check`
- `npm --prefix web run build`，仅前端变更需要