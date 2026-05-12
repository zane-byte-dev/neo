# Settings Guidance And System Status

## Background

Neo 当前已经具备较完整的模型配置、技能、应用、MCP、自动化与安全确认能力，但多个产品文档和当前代码都指向同一个体验问题：能力已足够强，界面仍然缺少清晰的分层、修复指引和系统状态表达。

这次方案把四个相关问题放在同一条 UX 主线上处理：

- 统一危险操作确认交互
- 设置页做基础 / 高级分层
- 错误提示补上“下一步怎么修”
- 增加系统状态卡片

这四项不是孤立需求，而是在解决同一个用户问题：用户不知道哪些操作是危险的，不知道哪些设置是入门必需，不知道出错后该去哪里修，也不知道系统当前是否已经 ready。

相关来源：

- [PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md](../../product/PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md)：提出统一危险确认、设置分层、错误修复建议和系统状态卡片。
- [PM_AUDIT_REPORT.md](../../product/PM_AUDIT_REPORT.md)：指出设置密度、空状态、运行控制与配置混杂等问题。
- [ROADMAP.md](../../product/ROADMAP.md)：P1 Web UI 增强仍强调降低新手认知负担和提升配置可理解性。

## Evidence And Freshness Check

本 Brief 没有直接沿用旧体验报告，而是先用当前代码和运行中的页面状态做了核验。

### 1. 危险确认并未完全统一

- `web/src/components/ConfirmDialog.tsx` 已经是应用级确认弹窗基础设施，且 `ChatArea`、`SettingsPanel`、Notebook 相关组件都在复用。
- 但 `web/src/components/Sidebar.tsx` 当前批量删除会话仍直接调用 `window.confirm(...)`，说明危险确认链路仍有遗漏。

### 2. 设置页仍是扁平结构，没有基础 / 高级分层

- `web/src/components/SettingsPanel.tsx` 当前顶层 tab 仍是并列的 `models / skills / apps / mcp / automations`。
- 当前结构默认把高级能力与核心入门能力并列展示，对首次配置用户不够友好。

### 3. 错误展示大多还是“报错即结束”，缺少修复动作

- `web/src/components/SettingsPanel.tsx`、`SkillsPanel.tsx`、`Sidebar.tsx`、多个 Notebook 组件里仍大量直接显示 `err.message` 或通用失败 toast。
- 这些错误通常没有告诉用户下一步该去哪个页面、改哪个字段、是否可以重试。

### 4. 系统状态已有零散数据源，但没有统一状态面板

- `web/src/components/ModelPanel.tsx` 已有 provider health 卡片，数据来自 `GET /api/models` 的 `providerStatus`。
- `GET /api/preferences` 已返回 Telegram 运行态。
- `GET /api/me` 当前只返回 `userId / displayName / profile`，没有工作目录、后端健康、自动化最近状态等更完整的系统 readiness 信息。
- 说明状态能力不是完全没有，而是还停留在分散展示，尚未形成统一的“系统是否准备好”表达。

### 5. 当前共享页面也暴露了修复指引不足

- 浏览器快照显示页面壳子可见，但 `/api/me`、`/api/preferences`、`/api/models` 等请求出现 500 或中断。
- 由于当前共享页面处于异常状态，本次 UI 核验以源码为主、浏览器快照为辅；但这也反过来说明“系统异常时缺少明确修复路径”的问题是真实存在的。

结论：这四项问题在当前代码中仍成立，但它们不需要四套独立方案，更合适作为同一个 UX 改造主题推进。

## User Problem

用户在 Neo 里会遇到三个连续断点：

1. 不清楚哪些操作风险更高，确认交互也不完全一致。
2. 不清楚进入设置后先做什么，哪些属于日常必需，哪些属于高级扩展。
3. 一旦失败，不知道下一步该去哪修，也不知道当前系统是不是已经配置正确。

这会直接带来以下后果：

- 新用户容易把产品理解成“功能很多，但上手路径不明确”。
- 高级用户也需要靠经验记忆 API Key、Telegram、MCP、自动化分别在哪修。
- 失败反馈无法形成闭环，用户只能看到错误，不能快速恢复。

## Goals

- 所有 destructive 用户操作统一使用同一套确认交互和文案语义。
- 设置页默认先表达“基础配置路径”，把高级能力延后暴露。
- 常见错误都能附带清晰的下一步修复动作，而不是只显示失败结果。
- 提供一个能表达“当前系统 ready 程度”的状态卡片，减少用户猜测。
- 尽量复用现有接口和组件基础，先做低风险、可渐进上线的版本。

## Non-goals

- 本轮不做完整的设置中心重设计，不重写所有设置页面布局。
- 本轮不做完整运维控制台或 SRE 级 observability dashboard。
- 本轮不改变运行时工具确认的后端机制，只统一 Web 端用户侧危险操作交互。
- 本轮不引入完整的新手教程、多步骤浮层 tour 或视频引导。

## Target Users And Scenarios

目标用户：

- 第一次配置 Neo 的本地用户。
- 回来补配置、接入新模型或调试自动化的老用户。
- 在配置、删除、保存、启用时遇到报错的用户。

核心场景：

1. 用户进入设置页，希望快速完成最小配置，只看到基础设置并清楚知道下一步。
2. 用户执行批量删除、删除配置、删除资源等危险操作时，得到一致、可预期的确认交互。
3. 用户开启 Telegram、保存 MCP、保存自动化或切换模型时，如果失败，界面明确告诉他去哪修。
4. 用户想判断系统是否 ready 时，不需要自己跨多个页面推断模型、后端和自动化状态。

## Proposed Experience

### 1. 统一危险操作确认交互

把所有用户主动触发的 destructive 操作统一收敛到 `ConfirmDialog`，包括但不限于：

- 批量删除会话
- 删除应用
- 删除 MCP Server
- 删除自动化任务
- 删除 Notebook 资源

统一后的交互规则：

- 使用同一套 modal 样式、危险色、按钮顺序和键盘行为。
- 标题明确表达动作与对象，例如“删除 3 个会话？”。
- 正文说明后果，例如“删除后无法恢复”。
- 批量操作可展示数量，必要时附带前几个对象名。
- 取消和确认按钮文案统一，不再混用浏览器原生确认框。

说明：运行中的工具审批流不与“删除确认”混成同一组件语义，但视觉语言应继续保持一致。

### 2. 设置页基础 / 高级分层

在设置页增加一层清晰的分组导航，而不是继续让所有能力平铺为并列 tab。

建议首版分层：

- Basic：Overview、Models、Skills
- Advanced：Apps、MCP、Automations

其中：

- `Overview` 是新增入口，承载系统状态卡片和少量快捷修复入口。
- `Models` 默认只强调模型配置、当前已配置模型和 provider health。
- `Skills` 仍保留在基础层，因为它属于用户较早会接触的能力增强。
- `Apps / MCP / Automations` 统一归入高级层，避免新用户一开始就暴露全部扩展面。

渐进策略：

- Phase 1：只在 `SettingsPanel` 顶层加 Basic / Advanced 分组，不强制重写各 tab 内部结构。
- Phase 2：如果验证后仍有混淆，再继续把 `ModelPanel` 里的路由参数、Telegram、审批规则等进一步拆到更明确的高级面板。

### 3. 错误提示补“下一步怎么修”

把错误提示从“技术结果展示”升级为“可行动恢复提示”。

建议定义统一的前端错误展示结构：

- 发生了什么
- 可能原因
- 下一步动作按钮
- 技术详情折叠区

首批需要覆盖的错误类型：

- 未登录或会话失效：提示重新登录。
- 后端不可达或 5xx：提示检查服务状态并重试。
- 未配置模型 / provider 不可用：提示去 Models 补 API Key 或检查本地运行时。
- Telegram 启用失败：提示去 Telegram 凭据区补 token。
- MCP / Cron 保存失败：提示检查必填项与格式，并保留原始错误详情。

展示原则：

- toast 只负责给出简短结果。
- 与当前页面强相关的失败，需要在页面内显示持久的 inline error banner。
- error banner 必须允许用户直接跳到对应修复入口，而不是让用户自己猜。

### 4. 增加系统状态卡片

新增一个面向普通用户的 `System Status` 卡片，优先放在 `Settings / Basic / Overview`，用于表达“系统是否可以开始工作”。

首版建议展示四类状态：

- Backend：前端是否能正常拿到核心 API 数据。
- Account / Workspace：当前用户是谁，以及当前工作区是否已初始化。
- Models：是否至少有一个可用模型，provider health 是否存在异常。
- Automation / Runtime：Telegram 是否可用、是否存在自动化配置、是否有最近错误。

状态卡片表现形式建议：

- 顶部一个总体状态：Ready / Needs attention。
- 下方 3 到 4 个子卡片，每个子卡片都有摘要和一个主动作按钮。
- 例如：`未配置模型 -> 去配置`、`后端异常 -> 刷新 / 查看详情`、`Telegram 缺少 token -> 去补全`。

数据策略建议分两步：

- Phase 1：前端先聚合现有 `GET /api/me`、`GET /api/preferences`、`GET /api/models`，做一个低成本版本。
- Phase 2：新增 `GET /api/system-status` 聚合接口，把工作目录、关键 readiness、自动化最近状态、统一错误摘要一起返回。

### 5. 交付顺序

建议按下面顺序落地，而不是四项并行展开：

1. 危险确认统一
2. 错误提示可行动化
3. 设置页 Basic / Advanced 分层
4. 系统状态卡片与聚合接口

原因：

- 第 1 项最小、最确定，能快速消除明显不一致。
- 第 2 项直接改善异常恢复体验，并为状态卡片提供文案和动作模型。
- 第 3 项解决信息架构问题。
- 第 4 项最适合在已有错误模型和分层结构稳定后接入。

## Documentation Impact

如果该方案实施，以下文档需要同步：

- `docs/user-guide/AGENT_RUNTIME.md`：补充新的设置分层、系统状态卡片和错误修复入口说明。
- `README.md`：更新首次配置与设置入口描述，避免仍按旧的扁平 tab 方式介绍。
- `CHANGELOG.md`：记录 UX 行为变化。
- `docs/product/PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md`：为这四项建议增加状态更新，避免未来继续把它们视为纯待讨论项。
- `docs/product/ROADMAP.md`：若确认纳入排期，可在 P1 Web UI 增强项下补一条“设置清晰度与系统状态”条目，或在已有条目中补状态说明。

## Acceptance Criteria

- Web 端所有 destructive 用户操作不再使用 `window.confirm`，统一走 `ConfirmDialog`。
- 设置页默认先进入 `Basic` 视图，且 `Apps / MCP / Automations` 不再与 `Models / Skills` 并列首屏展示。
- 至少覆盖 3 类高频错误的“下一步怎么修”提示，并能直达对应修复入口。
- 设置页存在一个系统状态卡片，至少展示用户、模型可用性、后端可达性三类状态。
- 系统状态卡片在移动端不溢出、不遮挡主要操作区。
- 新增文案支持中英文 i18n，不新增硬编码中文或英文。
- 新增状态判断和关键交互具备自动化测试或组件级回归测试覆盖。

## Risks And Dependencies

- 如果没有统一错误码，前端只能先基于 `status + message` 做错误映射，后续可能需要后端补结构化错误。
- `GET /api/me` 当前没有工作目录等信息，系统状态卡片若要展示完整上下文，可能需要新增聚合接口。
- 设置分层如果做得过重，可能让老用户觉得常用高级功能被藏得太深，因此需要保留可直达路径。
- 当前共享页面存在 500 错误，真实验收前仍需在健康环境下再次走查。

## Priority

整体优先级建议为 P1，但建议拆成两个节奏：

- P0 小切片：统一危险确认交互。
- P1 主题迭代：错误修复引导 + 设置分层 + 系统状态卡片。

原因：这组改动不阻塞核心功能，但它直接决定用户能否顺畅完成“配置 - 使用 - 发现问题 - 修复问题”的闭环。

## Open Questions

- `System Status` 卡片是否只放在设置页，还是也要在 Chat 欢迎页放一个精简版？
- `Telegram` 应继续算作基础设置，还是与审批 / 路由一起归入高级运行时设置？
- 自动化状态首版是否只显示“已配置 / 未配置”，还是需要包含最近一次执行结果？
- 错误提示是否需要统一的错误码协议，还是先做前端映射 MVP？

## Suggested Next Step

下一步进入 Dev Plan 阶段，建议输出：

```text
docs/features/settings-guidance-and-system-status/plan.md
```