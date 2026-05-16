# Automation 使用指南

Neo 支持三类自动化入口：Webhook 主动触发 Agent，Cron 定时触发 Agent，以及 Workflow 串联多个确定性步骤。Agent / Workflow 运行都会写入运行记录；Cron 列表会展示最近一次运行状态、耗时、摘要和错误。

## Workflow

Workflow 保存于 `{stateDir}/workflows/workflows.json`，也可以在 Web UI 的 `Settings / Advanced / Automations` 中用 JSON 编辑。首版支持三类步骤：

| 步骤 | 说明 |
|------|------|
| `transform` | 使用模板拼接文本，适合整理输入或映射变量 |
| `agent` | 向 Agent 发送一条任务消息，复用现有工具与 run 机制 |
| `skill` | 调用 Settings / Skills 中已有的 Skill |

模板可使用：

| 变量 | 说明 |
|------|------|
| `{{input.message}}` | 本次运行输入中的字段 |
| `{{previous}}` | 上一步输出 |
| `{{steps.stepId}}` | 指定步骤的输出 |
| `{{now}}` | 当前 ISO 时间 |

示例：

```json
{
  "name": "Morning brief workflow",
  "description": "收集输入后交给 Agent 总结",
  "enabled": true,
  "trigger": { "type": "manual" },
  "steps": [
    { "id": "collect", "type": "transform", "template": "Input: {{input.message}}" },
    { "id": "summarize", "type": "agent", "message": "用三条要点总结：\n{{previous}}" }
  ]
}
```

支持的触发器：

```json
{ "type": "manual" }
```

```json
{ "type": "webhook", "secret": "optional-workflow-secret" }
```

```json
{ "type": "cron", "cron": "0 8 * * *", "timezone": "Asia/Shanghai", "enabled": true }
```

Workflow API：

| API | 说明 |
|-----|------|
| `GET /api/workflows` | 列出工作流与最近运行状态 |
| `PUT /api/workflows/:id` | 创建或覆盖工作流 |
| `DELETE /api/workflows/:id` | 删除工作流 |
| `POST /api/workflows/:id/run` | 手动运行工作流，body 可传 `{ "input": {...} }` |
| `GET /api/workflows/:id/runs` | 查看运行历史 |
| `POST /api/workflow-webhook/:userId/:id` | 用 secret 从外部触发 webhook 工作流 |

Webhook Workflow 请求体示例：

```json
{
  "secret": "optional-workflow-secret-or-user-webhook-secret",
  "input": { "message": "总结今天 inbox 里的新内容" }
}
```

如果工作流没有配置独立 `trigger.secret`，会回退使用用户配置里的 `webhookSecret`。

## Webhook

Webhook 路径：

```text
POST /api/webhook/:userId
```

请求体：

```json
{
  "secret": "your-webhook-secret",
  "message": "总结今天 inbox 里的新内容",
  "sessionId": "optional-stable-session-id"
}
```

`secret` 来自用户配置中的 `webhookSecret`：

```ts
const config = {
  USERS: [
    {
      id: 'alice',
      name: 'Alice',
      webToken: '...',
      webhookSecret: 'long-random-string',
      workDir: '/abs/workspace',
      stateDir: '/abs/state',
      tenants: [],
    },
  ],
  SESSION_SECRET: '...',
};
```

示例：

```bash
curl -X POST http://localhost:3000/api/webhook/alice \
  -H 'Content-Type: application/json' \
  -d '{"secret":"long-random-string","message":"生成一份晨间简报"}'
```

成功响应包含 `sessionId`、`runId`、`response` 和 `artifacts`。

## Cron 定时任务

Cron 任务保存于 `{stateDir}/memory/schedule.json`，也可以在 Web UI 的 `Settings / Advanced / Automations` 中管理。

```json
[
  {
    "id": "morning-brief",
    "cron": "0 8 * * *",
    "message": "给我今天的天气和日程摘要",
    "enabled": true,
    "timezone": "Asia/Shanghai",
    "telegramChatId": "123456789"
  }
]
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 任务标识，1-64 个字母、数字、点、下划线或连字符 |
| `cron` | 是 | node-cron 支持的 cron 表达式 |
| `message` | 是 | 到点后发送给 Agent 的任务指令 |
| `enabled` | 否 | `false` 时不调度，默认启用 |
| `timezone` | 否 | IANA 时区，默认 `Asia/Shanghai` |
| `telegramChatId` | 否 | 配置后把结果发送到对应 Telegram chat |

内置系统任务会每天 08:00 Asia/Shanghai 刷新用户 NOW 状态。

## Cron API

| API | 说明 |
|-----|------|
| `GET /api/crons` | 列出任务 |
| `PUT /api/crons/:name` | 创建或覆盖任务 |
| `PATCH /api/crons/:name` | 修改任务 |
| `POST /api/crons/:name/run` | 手动触发一次 Cron 任务 |
| `GET /api/crons/:name/runs` | 查看 Cron 运行历史 |
| `DELETE /api/crons/:name` | 删除任务 |

修改任务后，Neo 会调用 `reloadSchedules()` 重新加载调度。

## 排查

- Webhook 返回 404：检查 `userId` 是否存在、是否配置 `webhookSecret`。
- Webhook 返回 401：检查请求体里的 `secret`。
- Cron 不执行：检查 cron 表达式、`enabled`、时区，以及后端进程是否正在运行。
- Telegram 不推送：先看 `Settings / Basic / Overview` 的 Automation 卡片是否异常，再到 `Settings / Basic / Models` 确认 Telegram Bot Token 已配置，并检查 `telegramChatId` 是否正确。