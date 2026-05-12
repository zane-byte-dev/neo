# AI 开发指南

> 面向在 VS Code + GitHub Copilot 中开发 Neo 的项目使用者与贡献者。流程定义见 [Copilot AI Loop](../developer-guide/COPILOT_AI_LOOP.md)；这份文档只回答一件事：实际开发时该怎么跑。

## 这套机制解决什么问题

Neo 已经把 GitHub Copilot 的协作流程拆成五段：

```text
Product Brief -> Dev Plan -> Implementation -> Test Review -> Release Closeout
```

它不是让你“把需求扔给 AI 然后等结果”，而是要求每一段都留下可交接的文档和验证记录。这样做的价值是：

- 需求不会只停留在聊天记录里。
- 开发实现有明确范围，不容易被 AI 静默扩 scope。
- 测试和发布回写有据可查，不需要事后猜“这个改动是怎么来的”。

## 什么时候用完整流程

下面这些场景，建议走完整五段流程：

- 新功能。
- 影响用户体验的交互调整。
- 需要跨前后端、文档、测试联动的改动。
- 你怀疑历史文档已经过期，想先核验再开发。

如果只是非常小的修复，例如错字、注释修正、局部样式微调，可以裁剪成：

```text
Freshness Check -> Implementation -> Test Review
```

但即使是简化流程，也不要跳过核验和验证。

如果你不想手动逐段切换五个 prompt，也可以直接使用 [../../.github/prompts/full-feature-loop.prompt.md](../../.github/prompts/full-feature-loop.prompt.md)。这个 prompt 适合“需求已经比较清楚，希望 Copilot 从 Product Brief / Dev Plan 一路推进到实现、测试报告和文档回写”的场景；它的默认结束条件不是“代码写完”，而是“本轮闭环做完或明确写出阻塞”。

## 开始前的准备

开始前确认下面几项：

- 你在 VS Code 中打开的是 Neo 仓库根目录。
- GitHub Copilot Chat 可用，并能读取 `.github/prompts/` 下的 prompt 文件。
- 你知道这次改动更接近产品问题、实现问题还是测试问题。
- 如果要改 UI，最好能本地启动：`npm run dev:bot` 和 `npm run web:dev`。
- 如果要改代码，准备好验证命令：`npm run build`、`npm test`、`npm --prefix web run build`、`npm run docs:check`。

仓库级约束已经写在 [../../.github/copilot-instructions.md](../../.github/copilot-instructions.md)；提交代码前的通用约束见 [../../CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 五段式开发流程

| 阶段 | 你给 Copilot 的输入 | 预期输出 | 默认落点 |
|------|---------------------|----------|----------|
| Product Brief | 功能想法、用户问题、旧文档、体验反馈 | 可交接的需求文档 | `docs/features/<slug>/brief.md` |
| Dev Plan | Product Brief | 可执行的工程计划 | `docs/features/<slug>/plan.md` |
| Implementation | Dev Plan + 允许开始实现 | 代码、文档、验证结果 | `src/`、`web/`、`docs/` |
| Test Review | Product Brief、Dev Plan、当前 diff | 测试报告、风险、补测建议 | `docs/features/<slug>/test-report.md` |
| Release Closeout | 已通过验证的结果 | Roadmap、Changelog、文档回写 | `docs/`、`CHANGELOG.md` |

### 1. 先跑 Product Brief

在 Copilot Chat 中输入 `/`，选择 [../../.github/prompts/product-brief.prompt.md](../../.github/prompts/product-brief.prompt.md)，再补充你的具体需求。

推荐输入方式：

```text
我想给 Neo 的欢迎页增加一个首次使用清单。
请先核验当前代码、API 和 UI，确认这个需求是否已经实现或部分实现。
然后输出 Product Brief。
```

这一段最重要的不是“写得漂亮”，而是先核验事实。Product Brief 必须包含 `Evidence And Freshness Check`，因为：

- 历史产品文档可能已经过期。
- 体验问题可能已经被修掉。
- 当前代码、API 和 UI 行为才是第一事实来源。

你在这一段要重点检查：

- 验收标准是不是可测试。
- 有没有明确本轮不做的内容。
- 有没有把旧文档和当前实现冲突的地方写清楚。
- 有没有列出这次改动会影响哪些 README、用户指南、FAQ 或产品状态文档。

### 2. 再跑 Dev Plan

Product Brief 确认后，在 Copilot Chat 中选择 [../../.github/prompts/dev-plan-from-product.prompt.md](../../.github/prompts/dev-plan-from-product.prompt.md)，输入 Product Brief 的路径。

推荐输入方式：

```text
请基于 docs/features/first-run-checklist/brief.md 生成开发计划。
重点说明要改哪些文件、状态来源、测试计划和本轮不做的内容。
```

Dev Plan 不是 PRD 的重复版。它应该把产品语言翻译成工程约束。你要重点检查：

- 相关模块是否找对了。
- 文件级改动范围是否清楚。
- 需要同步更新的文档有没有被明确列出来。
- 测试计划是否和改动范围匹配。
- 有没有把兼容性或迁移风险说清楚。

### 3. 再让 Copilot 实现

当 Dev Plan 没有明显漏洞后，选择 [../../.github/prompts/implement-dev-plan.prompt.md](../../.github/prompts/implement-dev-plan.prompt.md)，把 Dev Plan 路径交给 Copilot，并明确允许它开始改代码。

推荐输入方式：

```text
按 docs/features/first-run-checklist/plan.md 开始实现。
保持范围和计划一致，先做最小可行版本；如果发现计划和代码现实冲突，先说明调整理由。
```

这一段要盯住两件事：

- AI 是否在按计划落地，而不是顺手重构无关代码。
- AI 是否在实现后真的跑了对应验证，而不是只说“应该没问题”。
- 对用户可见行为变化，AI 是否已经在同一轮里同步更新相关文档，而不是把它悄悄留到以后。

### 4. 用 Test Review 做验收

实现完成后，选择 [../../.github/prompts/test-review.prompt.md](../../.github/prompts/test-review.prompt.md)，让 Copilot 对照 Product Brief、Dev Plan 和当前 diff 做测试审查。

推荐输入方式：

```text
请基于 docs/features/first-run-checklist/brief.md、
docs/features/first-run-checklist/plan.md
和当前 git diff 做测试审查。
优先找验收缺口、回归风险和缺失测试。
```

测试审查的关键不是“全绿”两个字，而是：

- 验收标准有没有逐条覆盖。
- 受影响的 README、用户指南和状态文档有没有同步。
- 还有哪些场景没测到。
- 风险是可以接受，还是必须继续修。

如果功能已经实现，但文档还停留在“建议中”或“待实现”，这应该被记为 finding，而不是可选优化。

如果需要正式留档，测试报告应写入 `docs/features/<slug>/test-report.md`。

### 5. 最后做 Release Closeout

只有在实现和测试都成立后，才进入 Closeout。选择 [../../.github/prompts/release-closeout.prompt.md](../../.github/prompts/release-closeout.prompt.md)，把 feature slug、测试报告或验证结果交给 Copilot。

推荐输入方式：

```text
请基于 first_run_checklist 的实现结果和测试报告做 closeout。
只更新已经完成的 Roadmap、docs 索引、用户文档和 CHANGELOG。
```

这一段的目标不是“再写一篇总结”，而是把这轮迭代真正写回仓库记忆。

如果某份历史文档因为本次实现已经过期，Closeout 至少要补状态更新，避免后来的人误以为功能还没做。

## 最小可复制示例

下面是一轮可以直接复用的调用顺序：

1. `product-brief.prompt.md`
   输入：欢迎页首次使用清单想法 + 要求核验当前代码。
   输出：`docs/features/first-run-checklist/brief.md`
2. `dev-plan-from-product.prompt.md`
   输入：`docs/features/first-run-checklist/brief.md`
   输出：`docs/features/first-run-checklist/plan.md`
3. `implement-dev-plan.prompt.md`
   输入：`docs/features/first-run-checklist/plan.md`
   输出：代码改动、i18n、store、验证结果。
4. `test-review.prompt.md`
   输入：Product Brief + Dev Plan + 当前 diff
   输出：`docs/features/first-run-checklist/test-report.md`
5. `release-closeout.prompt.md`
   输入：feature slug + test report
   输出：`docs/README.md`、`CHANGELOG.md` 等回写。

如果你已经有较清晰的功能输入，也可以直接用 [../../.github/prompts/full-feature-loop.prompt.md](../../.github/prompts/full-feature-loop.prompt.md) 代替上面 2 到 5 步，让 Copilot 在一轮里继续推进到验证、测试报告和 closeout；如果中途被阻塞，它应该把阻塞写回对应文档，而不是提前停下。


如果你不确定 AI 当前是否偏题，一个简单办法是检查仓库里是否真的出现了这三类文档：

- `docs/features/<slug>/brief.md`
- `docs/features/<slug>/plan.md`
- `docs/features/<slug>/test-report.md`

缺任何一类，通常都说明流程还没有闭环。

## 使用时最容易出错的地方

### 把旧文档当成事实

这是最常见的问题。Neo 当前的约束是：产品文档只能当线索，不能直接当真相。只要需求来自旧文档、体验审查或路线图，就要先对照当前代码、API、测试和 UI 再下结论。

### 让 AI 静默扩大范围

如果 Product Brief 写的是欢迎页优化，Implementation 阶段却顺手改了聊天状态管理、Notebook 架构或 unrelated refactor，这就是明显跑偏。范围一旦变化，应该先回写到计划或说明里，而不是直接混在实现里。

### 没有把验证命令跑完

对 Neo 来说，文档更新至少要跑 `npm run docs:check`；前端改动至少要跑 `npm --prefix web run build`；后端改动通常要跑 `npm run build` 和相关 `npx vitest run ...`。没有验证结果的“已完成”，可信度很低。

### 测试报告只写总结，不写问题

`test-review.prompt.md` 默认要求先写 findings，再写总结。如果没有问题，也要明确写“没有发现阻塞问题，但仍有这些测试缺口”。

## 你可以把这套机制当成什么

更准确地说，它不是一个“自动开发按钮”，而是一套文档驱动的协作协议：

- Product Brief 负责定义问题。
- Dev Plan 负责约束实现。
- Implementation 负责落地并验证。
- Test Review 负责做独立审查。
- Release Closeout 负责把结果写回项目记忆。

如果你只是想让 Copilot 帮你写几行代码，这份文档可能太重；但如果你要让 AI 参与一轮真实迭代，这套流程会比纯聊天稳定得多。

## 相关文档

- [Copilot AI Loop](../developer-guide/COPILOT_AI_LOOP.md)
- [Contributing Guide](../../CONTRIBUTING.md)
- [Test Plan](../testing/TEST_PLAN.md)
- [Docs Index](../README.md)
