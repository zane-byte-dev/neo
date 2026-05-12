# GitHub Copilot AI Loop

> Neo 的第一版 AI 工作流面向 GitHub Copilot 落地：用仓库文档作为角色交接物，让产品、开发、测试在同一个代码库里形成可追踪闭环。

## 目标

把一次功能迭代从“聊天里的想法”变成可执行、可验证、可回溯的流程：

```text
Product Brief -> Dev Plan -> Implementation -> Test Review -> Release Closeout
```

这个流程暂时不要求 Neo 内置工作流引擎。先让 Copilot 在真实开发中稳定执行，等模式跑顺后，再产品化为 Neo 的 skill、workflow 或多 Agent 编排能力。

## 角色与交付物

| 阶段 | Copilot 角色 | 主要输入 | 主要输出 | 建议位置 |
|------|--------------|----------|----------|----------|
| Product Brief | 产品经理 | 用户想法、竞品、Roadmap、体验报告 | 需求背景、目标、范围、验收标准 | `docs/product/FEATURE_<slug>.md` |
| Dev Plan | 开发负责人 | Product Brief、开发者文档、现有代码 | 模块方案、任务拆分、测试策略 | `docs/developer-guide/FEATURE_<slug>_PLAN.md` |
| Implementation | 编码 Agent | Dev Plan、相关代码、测试约束 | 代码变更、文档更新、自测结果 | `src/`、`web/`、`docs/` |
| Test Review | 测试负责人 | Product Brief、Dev Plan、git diff、测试计划 | 测试报告、风险、补测建议 | `docs/testing/FEATURE_<slug>_TEST_REPORT.md` |
| Release Closeout | 发布负责人 | 最终 diff、测试结果、产品验收 | Roadmap、Changelog、发布说明更新 | `docs/product/`、`CHANGELOG.md` |

## 推荐入口

这些 prompt 位于 `.github/prompts/`，可在 Copilot Chat 中通过 `/` 选择运行：

| Prompt | 用途 |
|--------|------|
| `product-brief.prompt.md` | 把原始想法整理成产品需求文档 |
| `dev-plan-from-product.prompt.md` | 基于产品文档生成开发计划 |
| `full-feature-loop.prompt.md` | 从产品文档直接推进到实现、验证、测试报告和回写 |
| `implement-dev-plan.prompt.md` | 按开发计划完成代码和文档改动 |
| `test-review.prompt.md` | 对照需求、计划和 diff 做测试审查 |
| `release-closeout.prompt.md` | 更新 Roadmap、Changelog 和发布资料 |

## 阶段要求

### 1. Product Brief

Product Brief 要回答“为什么做、给谁做、做到什么程度”。必须包含：

- 背景与用户问题
- 证据与新鲜度核验：旧文档只是线索，必须用当前代码、API、测试或 UI 状态确认问题仍然存在
- 目标用户和核心场景
- 目标与非目标
- 用户流程或关键交互
- 验收标准
- 风险、依赖与优先级
- 需要更新的文档或模块，以及哪些历史文档会因此过期

如果需求来自产品审查或竞品调研，应链接到 `docs/product/` 下的来源文档。

如果来源文档与当前代码冲突，以当前代码和可运行行为为准，并在 Product Brief 中记录旧文档可能过期。

### 2. Dev Plan

Dev Plan 要把产品语言翻译成工程语言。必须包含：

- 当前系统相关模块
- 目标实现形态
- 文件级变更清单
- 数据结构、API 或 UI 状态变化
- 文档更新计划：哪些 README、用户指南、FAQ、路线图、Feature 状态文档要同步
- 兼容性和迁移风险
- 测试计划
- 明确不做的内容

Dev Plan 不应直接跳进代码细节；它要让后续实现可以被约束和审查。

### 3. Implementation

实现阶段应严格按 Dev Plan 推进。允许在发现明显技术约束时调整方案，但需要在最终说明中写清楚：

- 哪些计划已完成
- 哪些文档已同步更新，哪些文档明确延后以及原因
- 哪些地方因代码现实做了调整
- 新增或更新了哪些测试
- 跑过哪些验证命令
- 还剩什么风险

如果改动会影响用户可见行为，或会让现有产品/用户文档显得过期，Implementation 阶段就应同步更新对应文档，而不是默认等 Release Closeout 兜底。

### 4. Test Review

测试审查要从“是否满足产品目标”出发，而不是只看测试是否通过。至少检查：

- Product Brief 的验收标准是否逐项覆盖
- Dev Plan 的实现任务是否完成
- 受影响的 README、用户指南、Feature Brief、路线图或体验审查文档是否已经同步
- 是否需要新增单元、集成或 E2E 测试
- 是否有回归风险、边界条件或迁移风险
- 当前验证命令是否足够

测试资料统一参考 `docs/testing/TEST_PLAN.md`。

### 5. Release Closeout

Closeout 阶段负责把迭代结果写回项目记忆。根据改动范围更新：

- `docs/product/ROADMAP.md`
- `CHANGELOG.md`
- `docs/product/RELEASE_NOTES_*.md`
- `docs/README.md`
- 相关用户指南或开发者指南
- 对应 Feature Brief、体验审查或其他会因本次实现而过期的状态文档

如果功能没有达到发布标准，应在产品文档或测试报告中记录阻塞原因，而不是假装完成。

## 文件命名建议

使用同一个 `<slug>` 串起一轮迭代：

```text
docs/product/FEATURE_<slug>.md
docs/developer-guide/FEATURE_<slug>_PLAN.md
docs/testing/FEATURE_<slug>_TEST_REPORT.md
```

示例：

```text
docs/product/FEATURE_copilot-ai-loop.md
docs/developer-guide/FEATURE_copilot-ai-loop_PLAN.md
docs/testing/FEATURE_copilot-ai-loop_TEST_REPORT.md
```

## 门禁定义

### Definition of Ready

进入实现前应满足：

- Product Brief 有明确验收标准。
- Dev Plan 指明具体改动范围。
- 已识别需要更新的测试与文档。
- 未解决的问题被明确列出。

### Definition of Done

完成一轮迭代前应满足：

- 如果迭代起点是 Product Brief，或本轮改动会影响用户可见行为，Dev Plan 状态、测试报告、相关产品 / 用户 / 发布文档必须已更新，或明确记录阻塞 / 延后原因。
- 代码或文档变更与 Dev Plan 对齐。
- 验收标准被逐项验证或说明未覆盖原因。
- 必要测试已新增或更新。
- 已运行合适的验证命令。
- 用户可见行为对应的 README、用户指南、FAQ 或状态文档已更新，历史文档中的过期描述已修正或补状态说明。
- Roadmap、Changelog 或发布资料已按需回写。

## 与 Neo 后续产品化的关系

这套 Copilot loop 是 Neo 工作流能力的 dogfood 场景。后续可以按稳定程度逐步演进：

1. 把 prompt 沉淀为 Neo skill。
2. 把阶段交接物结构化为 workflow state。
3. 让 Neo 自动创建 Product Brief、Dev Plan、Test Report。
4. 引入运行时事件和 artifacts，把每一轮迭代变成可恢复、可审计的 run。