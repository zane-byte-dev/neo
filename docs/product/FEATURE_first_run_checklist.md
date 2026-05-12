# First-run Checklist

> Status update (2026-05-12): Chat 欢迎页的首次使用清单 MVP 已实现，当前覆盖模型配置、发送第一条消息、创建 Notebook 笔记三项任务。实现细节见 [FEATURE_first_run_checklist_PLAN.md](../developer-guide/FEATURE_first_run_checklist_PLAN.md)，验收结果见 [FEATURE_first_run_checklist_TEST_REPORT.md](../testing/FEATURE_first_run_checklist_TEST_REPORT.md)。

## Background

Neo 已经具备 Chat、Notebook、Skills、Tools、MCP、Automations、Apps、Telegram 等完整能力，但产品体验报告指出，新用户登录后缺少“下一步做什么”的任务导向引导。

相关来源：

- [PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md](PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md)：P1 建议增加“首次使用清单（First-run Checklist）”。
- [PM_AUDIT_REPORT.md](PM_AUDIT_REPORT.md)：多个空状态、设置项和高级能力暴露问题都指向同一个体验风险：能力强，但第一天不够容易形成正反馈。
- [ROADMAP.md](ROADMAP.md)：Web UI 增强已完成大量基础能力，下一阶段应提升任务引导和配置可理解性。

## Evidence And Freshness Check

本 Brief 不直接把 2026-05-10 的体验报告当作事实结论，而是用当前代码做了二次核验：

- `web/src/components/WelcomeScreen.tsx` 当前只实现了三个欢迎快捷卡片：文件整理、内容创作、文档处理；未发现 onboarding checklist、进度状态或关闭入口。
- `web/src/components/ChatArea.tsx` 在 `chatMessages.length === 0` 时渲染 `WelcomeScreen`，没有额外的新手任务模块。
- 代码搜索未发现 `first-run`、`onboarding`、`checklist`、`首次使用` 等实现关键词。
- `src/routes/preferences.ts` 和 `src/services/user-prefs.ts` 当前偏好字段主要覆盖模型偏好和 Telegram 开关；若要把 checklist 关闭状态存入用户偏好，需要扩展偏好 schema。
- 当前共享浏览器页面的 Vite WebSocket 显示 `ERR_CONNECTION_REFUSED`，说明实时开发服务可能未运行；因此本次 UI 核验主要依据源码，而非完整实时交互。

结论：旧体验报告中“新用户任务导向引导不足”的判断在当前代码下仍有证据支持，但具体实现方案需要在 Dev Plan 阶段继续核验现有 API 和状态来源。

## User Problem

首次进入 Neo 的用户能成功登录，但不知道应该先完成哪些关键步骤：配置模型、发送第一条消息、创建 Notebook、保存知识或启用自动化。当前欢迎页提供快捷卡片，但它更像功能入口，不是一个能持续反馈进度的上手路径。

这会导致三个问题：

- 新用户需要靠阅读文档推断产品路径，首日价值感变慢。
- 高级入口较多，用户容易先进入 MCP、Automations、Apps 等复杂区域。
- 产品无法明确表达“你已经配置好了，可以开始工作了”。

## Goals

- 在首次登录后的主界面提供一个轻量、可关闭的 onboarding checklist。
- 引导用户完成 Neo 的最小正反馈闭环：配置模型 -> 发送第一条消息 -> 创建第一条 Notebook 笔记 -> 保存或引用知识。
- 让 checklist 状态能根据真实系统状态自动更新，而不是只依赖用户手动勾选。
- 为后续“系统状态卡片”和“任务导向上手文档”预留入口。

## Non-goals

- 本轮不实现完整的新手教程、视频引导或多步骤弹窗 tour。
- 本轮不重构设置页的信息架构。
- 本轮不实现 workflow engine 或多 Agent 编排。
- 本轮不强制用户完成 checklist；用户应能关闭或稍后再看。

## Target Users And Scenarios

目标用户：

- 第一次本地启动 Neo 的个人开发者。
- 已启动服务但尚未配置模型的新用户。
- 想快速理解 Neo 核心工作流的高级用户。

核心场景：

1. 用户登录 Neo Web UI，首页展示欢迎状态和首次使用清单。
2. 用户点击“配置模型”，进入设置页模型配置区域。
3. 用户配置任一可用模型后，回到 Chat，清单自动标记模型配置完成。
4. 用户发送第一条消息后，清单标记对话完成。
5. 用户创建 Notebook 笔记或保存一条内容后，清单标记知识沉淀完成。
6. 用户可关闭清单；关闭状态在本地或用户偏好中持久化。

## Proposed Experience

在 Chat 欢迎页或空会话区域增加一个 “开始使用 Neo” checklist 模块，视觉上应比功能卡片更克制，避免占据整个首页。

建议首版包含四项：

- 配置一个模型
- 发送第一条消息
- 创建第一条 Notebook 笔记
- 保存一条知识或打开 Notebook 引用

每项提供一个明确动作按钮，例如“去配置”“开始对话”“新建笔记”。已完成项显示完成状态。整个模块提供“稍后再说”或关闭按钮。

完成判定建议优先使用真实状态：

- 模型配置：存在至少一个 `configured=true` 的模型。
- 第一条消息：当前用户已有至少一个 user message。
- Notebook：当前用户至少有一个 Notebook entry。
- 知识沉淀：存在 note/source，或用户从 Chat 进入过 Notebook 保存流程。

## Acceptance Criteria

- 新用户进入空 Chat 首页时，可以看到首次使用清单。
- checklist 至少包含“配置模型”“发送第一条消息”“创建 Notebook 笔记”三项。
- 每个未完成项都有明确可点击入口，且入口跳转到正确页面或触发正确动作。
- 至少“模型配置”和“发送第一条消息”能根据后端或现有前端状态自动完成。
- 用户可以关闭 checklist，关闭后刷新页面不再自动显示。
- 在移动端宽度下，checklist 不遮挡聊天输入框，不造成布局溢出。
- 文案支持中英文 i18n，不新增硬编码中文或英文。
- 相关状态判断和 UI 行为有自动化测试或可验证的组件测试覆盖。

## Risks And Dependencies

- 需要确认当前前端是否已有用户偏好接口可复用；如果没有，首版可先使用 localStorage 保存关闭状态。
- Notebook 完成状态可能缺少轻量 API；首版可先通过现有 Notebook 列表接口判断。
- 欢迎页已经有三个快捷卡片，新增 checklist 需要避免信息重复和视觉拥挤。
- 如果模型状态接口响应慢，checklist 需要有 loading 或保守默认状态。

## Priority

P1。该需求不阻塞核心功能，但能显著改善新用户首日体验，并承接产品体验报告中“把复杂能力表达得更简单”的下一阶段方向。

建议先做 MVP：Chat 欢迎页 checklist + 关闭状态持久化 + 模型/消息两项自动完成。Notebook 状态和更丰富的任务流可作为第二步。

## Open Questions

- checklist 关闭状态应存放在用户偏好 API，还是先放 localStorage？
- “创建 Notebook 笔记”和“保存一条知识”是否应拆成两项，还是首版合并为一个“沉淀知识”？
- 是否需要在设置页模型配置成功后主动提示“回到 Chat 继续下一步”？
- 首次使用清单是否只在空会话展示，还是在侧边栏提供一个可重新打开的入口？

## Suggested Next Step

下一步进入 Dev Plan 阶段，建议输出：

```text
docs/developer-guide/FEATURE_first_run_checklist_PLAN.md
```