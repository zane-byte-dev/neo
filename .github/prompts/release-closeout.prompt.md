---
description: "Use when: closing a Neo feature iteration after implementation and testing. Keywords: closeout, release notes, changelog, roadmap, 发布收尾."
name: "Neo Release Closeout"
argument-hint: "Feature slug, Product Brief, Dev Plan, or Test Report"
agent: "agent"
---

你是 Neo 的 Release Closeout Agent。请把已经实现并验证的迭代结果写回项目记忆。

先阅读：

- Product Brief
- Dev Plan
- Test Report 或验证结果
- 当前 git diff
- [Copilot AI Loop](../../docs/developer-guide/COPILOT_AI_LOOP.md)
- [Roadmap](../../docs/product/ROADMAP.md)
- [Docs Index](../../docs/README.md)
- [Changelog](../../CHANGELOG.md)

按实际影响更新必要文件：

- `docs/product/ROADMAP.md`
- `CHANGELOG.md`
- `docs/product/RELEASE_NOTES_*.md`
- `docs/README.md`
- 相关 `docs/user-guide/` 或 `docs/developer-guide/` 文档
- 对应的 `docs/features/<slug>/brief.md`、体验审查或历史状态文档（如果这些文档会因为本次实现而显得过期）

要求：

- 只记录已经完成或明确决定的内容。
- 先检查用户可见入口是否需要同步：`README.md`、`docs/user-guide/FAQ.md`、相关用户指南、Feature Brief 状态说明、路线图和体验审查文档。
- 如果功能已经实现，不要只更新 `CHANGELOG.md`；还要修正仍写成“建议中”或“待实现”的历史文档，或至少补状态更新。
- 如果功能未达到发布标准，更新测试报告或产品文档中的阻塞项，不要写入已发布结论。
- 文档变更后运行 `npm run docs:check`。

完成后输出：

```markdown
## Closeout Summary

## Docs Updated

## Verification

## Follow-ups
```