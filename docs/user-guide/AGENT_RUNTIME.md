# Agent 运行时说明

Neo 的 Agent 运行时把每次对话、Webhook、Cron、Telegram 触发都持久化为一个 run。这样前端断线后可以按 cursor 追补事件，也能在工具确认后恢复执行。

## 磁盘布局

每个 run 位于 `{stateDir}/runs/{runId}/`：

```text
{stateDir}/runs/run_20260512_080000_abcd1234/
├── run.json
├── events.jsonl
├── checkpoint.json
├── pending.json
└── artifacts/
```

| 文件 | 说明 |
|------|------|
| `run.json` | run 元数据：状态、入口、触发类型、sessionId、请求摘要、错误与指标 |
| `events.jsonl` | append-only 事件流，每行一个事件，带递增 `index` |
| `checkpoint.json` | 恢复点：当前 phase、partial response、活动工具等 |
| `pending.json` | 等待确认或等待用户输入的动作 |
| `artifacts/` | 图片、视频、文件等运行产物 |

## run 状态

| 状态 | 说明 |
|------|------|
| `queued` | 已创建，尚未开始 |
| `running` | 正在执行 |
| `waiting_confirm` | 等待工具确认 |
| `waiting_input` | 等待用户输入 |
| `completed` | 成功完成 |
| `failed` | 执行失败 |
| `cancelled` | 用户取消 |
| `expired` | 等待动作超时 |

## 事件流

常见事件类型包括：`run_created`、`run_started`、`route_resolved`、`user_message_saved`、`llm_chunk`、`tool_call_started`、`tool_call_finished`、`todo_updated`、`artifact_created`、`confirm_requested`、`confirm_resolved`、`notebook_citations`、`run_completed`、`run_failed`。

前端 SSE 首包会拿到 `runId`。如果连接中断，前端可以调用：

```text
GET /api/runs/:id/events?cursor=N
```

只拉取 `index > N` 的事件，避免重复渲染。

## API

| API | 说明 |
|-----|------|
| `GET /api/runs?limit=50` | 列出当前用户的 runs |
| `GET /api/runs/:id` | 读取单个 run |
| `GET /api/runs/:id/events?cursor=N&limit=200` | 读取事件流 |
| `POST /api/runs/:id/cancel` | 请求取消正在运行的 run |

所有 `/api/runs` 接口都按当前登录用户隔离；猜到其它用户的 runId 也不能读取。

## 工具确认与恢复

危险工具会创建 pending action。用户批准后，Neo 会记录 `confirm_resolved`，并从 checkpoint 恢复执行。对于已经完成、失败、取消或过期的 run，取消 API 会返回 no-op 成功。

## 设置与系统状态

Web UI 的设置页现在分为两层：

| 分层 | 页面 | 用途 |
|------|------|------|
| Basic | Overview / Models / Skills | 查看系统是否 ready、配置模型、管理常用技能 |
| Advanced | Apps / MCP Servers / Automations | 管理应用、MCP 工具服务器、Webhook 与 Cron 自动化 |

进入 `Settings / Basic / Overview` 可以看到系统状态卡片。首版状态由现有接口聚合而来：账号来自 `/api/me`，模型与 provider health 来自 `/api/models`，Telegram 运行态来自 `/api/preferences`，Cron 数量来自 `/api/crons`。

当模型、Telegram、MCP 或自动化保存失败时，页面会保留内联错误提示，并给出重试、打开凭据区或检查必填字段等修复入口。Toast 只提示结果，具体排查信息放在页面内的“技术详情”中。

## 调试

- 查看 `{stateDir}/runs/<runId>/events.jsonl` 可以复盘工具调用和模型输出。
- 查看 `checkpoint.json` 可以确认断线前停在哪个 phase。
- 查看 `logs/YYYY-MM-DD.jsonl` 可以看到运行时错误、MCP 加载、沙箱 warning 等服务端日志。