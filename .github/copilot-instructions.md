# Neo Copilot 工作流

Neo 使用 GitHub Copilot 进行产品、开发、测试协作。默认遵循文档驱动闭环：产品提出需求，开发拆解实现，测试验证结果，最后回写路线图和发布资料。

## 文档分工

- 产品判断写入 `docs/product/`，包括 PRD、体验审查、竞品洞察、路线图和发布说明。
- 开发方案写入 `docs/developer-guide/`，包括架构计划、模块边界、实施步骤和兼容性说明。
- 测试策略与验收结果写入 `docs/testing/`，优先对照 `docs/testing/TEST_PLAN.md`。
- 用户可见行为变化需要同步更新 `docs/user-guide/`、`README.md` 或 `CHANGELOG.md`。

## 工作模式

- 修改代码前，先定位相关产品文档、开发文档和测试约束。
- 产品文档只能作为线索；如果文档可能过期，必须用当前代码、API、测试或 UI 状态核验后再下结论。
- 如果需求还不清楚，先产出或补全 Product Brief，再进入实现。
- 如果任务起点是 `docs/product/` 下的功能文档，默认按 Product Brief -> Dev Plan -> Implementation -> Test Review -> Release Closeout 走完整闭环；除非用户明确裁剪范围，不要在代码实现后提前结束。
- 如果实现范围超过产品文档，先回写风险或提出方案，不要静默扩大 scope。
- 如果改动会改变用户可见行为，或会让现有文档显得过期，先识别需要同步的 `docs/user-guide/`、`README.md`、`CHANGELOG.md`、`docs/product/` 文档；未更新或明确记录 defer 前，不算完成。
- 代码改动应保持聚焦，优先复用现有 `src/utils/`、服务层和测试 helper。
- 完成前必须运行并说明验证命令；后端优先 `npm run build` 和相关 `npx vitest run ...`，前端变更补充 `npm --prefix web run build`。

## 完成门槛

- 如果任务来源于 `docs/product/`、`docs/developer-guide/`，或会改变用户可见行为 / 让现有文档过期，代理必须在同一轮里尽量完成：更新 Dev Plan 或状态、实现代码、执行验证、补测试报告、回写相关产品文档与 `docs/user-guide/` / `README.md` / `CHANGELOG.md` / `docs/product/ROADMAP.md`。除非用户明确批准 defer，或存在已记录阻塞，否则缺任一项都视为未完成。
- 如果仓库没有现成自动化测试，不得跳过验证；必须退化为最窄可执行验证，例如 `npm run build`、`npx vitest run <target>`、`npm --prefix web run build`、`npm run docs:check`、浏览器 smoke，并把结果、缺口和阻塞写入 `docs/testing/` 报告或当前迭代文档。
- 最终答复前必须明确交代：改了哪些代码、更新了哪些文档、跑了哪些验证、还有哪些风险 / defer / blocker。不要把“代码已写完”当作“任务已完成”。

## 可复用 Prompt

常用流程在 `.github/prompts/`：

- `product-brief.prompt.md`：把想法整理成产品需求文档。
- `dev-plan-from-product.prompt.md`：把产品文档转成开发计划。
- `full-feature-loop.prompt.md`：从产品文档一路推进到实现、测试报告和发布回写。
- `implement-dev-plan.prompt.md`：按开发计划实现代码与文档更新。
- `test-review.prompt.md`：对照需求和 diff 做测试审查。
- `release-closeout.prompt.md`：收敛路线图、变更记录和发布说明。

详细流程见 `docs/developer-guide/COPILOT_AI_LOOP.md`。