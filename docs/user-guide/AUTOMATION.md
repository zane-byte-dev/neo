# Automation 使用指南

Neo 不执行 Cron、Webhook 或 Workflow。自动化的唯一执行器是 ATM scheduler：schedule 定义与 run 生命周期保存在 `~/.atm`，ATM 到点后启动 `pi --mode rpc`。Neo 的 `Settings / Automations` 只是 ATM 的管理界面；ATM 停止不会影响普通 Neo → Pi 会话。

## 启动

在 ATM 配置中声明 Pi、可信工作目录、可选 skills/extensions：

```json
{
  "automation": {
    "piExecutable": "pi",
    "allowedWorkDirs": ["~/mox/workspace"],
    "skills": ["~/mox/neo/pi/skills"],
    "extensions": [],
    "pollSeconds": 15,
    "maxConcurrent": 2
  }
}
```

然后启动本地服务：

```bash
atm serve --addr 127.0.0.1:7070
```

Neo 默认代理该地址；可用 `ATM_HTTP_URL=http://127.0.0.1:7070` 覆盖。地址必须是 loopback HTTP URL。

## Schedule 契约

```json
{
  "schemaVersion": 1,
  "id": "morning-brief",
  "name": "Morning brief",
  "enabled": true,
  "trigger": {
    "type": "cron",
    "cron": "0 8 * * 1-5",
    "timezone": "Asia/Shanghai"
  },
  "task": {
    "message": "生成今天的晨间简报",
    "workDir": "/absolute/trusted/workspace",
    "skill": "news-brief",
    "model": "provider/model",
    "tools": ["read", "grep", "find", "ls"]
  },
  "policy": {
    "timeoutSeconds": 900,
    "maxRetries": 1,
    "retryBackoffSeconds": 5,
    "concurrency": "forbid",
    "missedRun": "run_once"
  }
}
```

`trigger.type` 支持 `cron`、`webhook`、`manual`。Webhook schedule 需要至少 16 字符的 `webhookSecret`，调用时放在 `X-ATM-Webhook-Secret` 或 Bearer header；管理 API 不回显 secret。

权限默认收敛：`workDir` 必须位于 ATM 的 `allowedWorkDirs`；没有声明 `task.tools` 时只启用 `read,grep,find,ls`。ATX 不在默认链路中，只有把 provider extension 显式加入 `automation.extensions` 时才加载。

## 管理接口

Neo Web 调用 `/api/atm/*`，服务端再代理到 ATM：

| Neo API | ATM API | 用途 |
|---|---|---|
| `GET /api/atm/health` | `GET /health` | 检查 ATM 状态 |
| `GET/POST /api/atm/schedules` | `GET/POST /v1/schedules` | 列出/创建 schedule |
| `GET/PUT/DELETE /api/atm/schedules/:id` | `/v1/schedules/:id` | 读取/更新/删除 |
| `POST /api/atm/schedules/:id/run` | `/v1/schedules/:id/run` | 手动排队 |
| `GET /api/atm/runs` | `GET /v1/runs` | 查看 run |

外部 webhook 直接调用 ATM：

```bash
curl -X POST http://127.0.0.1:7070/v1/webhooks/morning-brief \
  -H 'X-ATM-Webhook-Secret: long-random-secret'
```

ATM run 只记录 `queued → running → succeeded|failed|cancelled|timed_out`、attempt 和 Pi session 引用。完整对话、工具轨迹和模型用量仍以 Pi session JSONL 为事实源，不复制进 ATM events。

## CLI

```bash
atm schedule save schedule.json
atm schedule list
atm schedule run morning-brief --wait
atm schedule runs morning-brief
atm schedule events <run-id>
atm daemon
```

## 排查

- Neo 显示 ATM unavailable：确认 `atm serve` 在配置的 loopback 地址运行。
- schedule 保存失败：检查五字段 Cron、IANA 时区、绝对 `workDir` 和 webhook secret。
- run 立即失败：检查 `allowedWorkDirs`、Pi 可执行文件、显式 tool allowlist 和 provider 凭据。
- ATM 离线：只影响管理页和自动运行，普通聊天不依赖 ATM。
