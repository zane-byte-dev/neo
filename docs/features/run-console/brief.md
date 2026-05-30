# Run Console

> Status: Draft  
> Source: [桌面 AI 助手能力补齐 Product Brief](../../product/DESKTOP_AI_ASSISTANT_GAP_BRIEF.md)  
> Priority: P0.1

## Background

Neo 的 Agent Runtime 已经把每次 Chat、Telegram、Webhook、Cron 和 Workflow 执行持久化为 run，并记录事件流、checkpoint、pending action 与 artifacts。相关能力见 [AGENT_RUNTIME.md](../../user-guide/AGENT_RUNTIME.md)。

但这些信息目前主要存在于 `{stateDir}/runs/<runId>/` 和 JSONL 日志中。用户在自动化失败、工具卡住、确认遗漏或 SSE 断线时，仍需要翻文件和日志才能理解问题。这让 Neo 的运行时透明度停留在“工程可调试”，还没有变成“产品可排障”。

Run Console 的目标是把已有运行时底座包装成一个用户可理解的运行记录面板，优先支撑后续 Workflow、连接器和后台自动化调试。

## User Problem

- 用户不知道最近一次 Agent / Workflow / Cron 为什么失败。
- 用户无法在 UI 中查看 run 的入口、触发方式、工具调用、确认状态和错误摘要。
- 当 run 卡在 `waiting_confirm`、`running` 或 `failed` 时，用户不知道下一步该取消、重试、继续确认还是查看日志。
- 连接器或 Workflow 上线后，如果没有统一 Run Console，排障会分散在各自页面里，体验会继续碎片化。

## Goals

- 在 Web UI 中提供近期 run 列表和详情页。
- 用用户能理解的事件时间线展示 run 生命周期。
- 支持筛选 running、waiting_confirm、completed、failed、cancelled 等状态。
- 对失败和等待确认的 run 给出明确下一步动作。
- 复用现有 runtime store、events API 和 cancel API，避免重建运行时。

## Non-goals

- 本轮不做完整 APM / metrics dashboard。
- 本轮不支持从任意 checkpoint 继续执行。
- 本轮不做单个工具调用的局部重试。
- 本轮不展示未脱敏的敏感参数、token、API Key 或完整文件内容。

## Proposed Experience

### 1. 入口

新增 `Settings / Advanced / Runs`，或在 Automations 页面增加“运行记录”子入口。首版建议独立为 `Runs`，因为它不仅服务 Workflow，也服务 Chat、Telegram、Webhook 和 Cron。

### 2. Run 列表

列表展示：

- Run ID 短标识
- 入口：web-chat / telegram / webhook / cron / workflow
- 触发类型
- 状态
- 开始时间与耗时
- 会话或 Workflow 名称
- 模型与 fallback 状态
- 工具调用数量
- 最近错误摘要

支持按状态和入口筛选，默认显示最近 50 条。

### 3. Run 详情

详情页展示事件时间线：

- run 创建和开始
- 路由结果与模型选择
- 用户消息摘要
- LLM 输出片段摘要
- 工具调用开始/结束、耗时、权限级别、错误
- confirm_requested / confirm_resolved
- todo_updated
- artifact_created
- run_completed / run_failed / cancelled

长文本默认折叠，工具参数和结果默认脱敏与截断。

### 4. 可操作状态

- `running`：提供取消按钮，复用 `POST /api/runs/:id/cancel`。
- `waiting_confirm`：展示待确认工具和确认入口，后续可复用现有确认 API。
- `failed`：展示错误摘要、失败事件和相关工具调用，首版可提供“复制调试摘要”。
- `completed`：展示 artifacts、token/cost 摘要和最终输出摘要。

## Acceptance Criteria

- 用户不用打开 `{stateDir}/runs` 文件夹，也能看懂最近一次 run 的状态和失败原因。
- Run 列表能区分 Chat、Cron、Webhook、Workflow 等入口。
- Run 详情中的事件顺序与 `events.jsonl` 保持一致。
- 危险工具调用、确认请求和确认结果在详情中可见。
- 敏感字段不会以明文暴露在 UI 中。

## Open Questions

- 首版 Run Console 是否需要直接暴露在侧边栏，还是只放在 Advanced Settings。
- failed run 的“重试”应从原始 request 重新跑，还是先只提供复制调试摘要。
- Workflow run 与 Agent run 是否在 UI 上合并展示，还是 Workflow 详情内嵌 Agent run 链接。