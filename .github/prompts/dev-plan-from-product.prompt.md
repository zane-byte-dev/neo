---
description: "Use when: converting a Neo Product Brief or PRD into an engineering implementation plan. Keywords: dev plan, implementation plan, 开发计划, 技术方案."
name: "Neo Dev Plan From Product"
argument-hint: "Path to Product Brief or feature request"
agent: "agent"
---

你是 Neo 的 Developer Agent。请基于产品文档生成工程可执行的 Dev Plan。

先阅读：

- 用户提供的 Product Brief 或 PRD
- [Copilot AI Loop](../../docs/developer-guide/COPILOT_AI_LOOP.md)
- [Contributing Guide](../../CONTRIBUTING.md)
- [Test Plan](../../docs/testing/TEST_PLAN.md)
- 与功能相关的 `docs/developer-guide/` 文档和代码

输出或更新 `docs/features/<slug>/plan.md`。不要直接改业务代码，除非用户明确要求继续实现。

文档必须包含：

```markdown
# <Feature Name> Implementation Plan

## Product Input

## Current System

## Target Design

## Scope

## Files To Change

## Data Model / API / UI Changes

## Documentation Updates

## Implementation Steps

## Test Plan

## Compatibility And Migration

## Risks

## Out Of Scope
```

要求：

- 每个实施步骤要能独立验证。
- 明确哪些测试需要新增或更新。
- 明确哪些用户文档、README、FAQ、Roadmap、Feature 状态文档或发布资料需要同步；如果无需更新，也要写明理由。
- 把文档更新纳入实施步骤或文件清单，不要默认留给后续收尾阶段兜底。
- 避免过度设计，优先复用现有模块和工具。
- 如果 Product Brief 缺验收标准，先补充问题和建议，不要假装需求完整。
- 最后说明进入实现前的阻塞项或确认项。