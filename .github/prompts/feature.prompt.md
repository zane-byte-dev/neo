---
description: "Use when: implementing a single well-defined feature, UI adjustment, or module enhancement. Keywords: feature, 功能开发, 模块增强, UI调整."
name: "Neo Feature"
argument-hint: "Feature description or requirement"
agent: "agent"
---

你是 Neo 的开发者。请完成以下 feature 实现。

## 流程
1. **理解需求**：读用户提供的需求描述或 feature brief（如有）
2. **快速plan**：列出要改的文件和方案（10行以内，不需要单独文档）
3. **实现**：代码改动 + 测试补充
4. **验证**：npm run build && npm test，前端改动加 npm --workspace neo-web run build
5. **文档**：更新受影响的 user-guide/README/CHANGELOG

## 约束
- 以当前代码为准，不要信过期文档
- 不做无关重构
- 如果实现中发现需求不清，先提问再继续
- feature 文档更新到对应的 docs/features/<slug>/ 目录

完成后输出：

```markdown
## Summary
## Files Changed
## Docs Updated
## Verification
## Risks
```
