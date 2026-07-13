# Pi 会话与 ATM 运行说明

Neo 不再维护独立 Agent runtime。手动对话和 Notebook Studio 直接连接 Pi RPC；定时、Webhook 和手动自动化由 ATM 调度 Pi RPC。两条链路彼此隔离：ATM 离线时，Neo 的普通对话仍可使用。

## 运行边界

| 场景 | 执行与持久化归属 |
|------|------------------|
| Web Chat / Notebook Studio | Neo 创建和复用 Pi session，并将流式事件转为 SSE |
| Cron / Webhook / 手动自动化 | ATM 保存 schedule、run 和事件，并启动独立 Pi RPC 进程 |
| 知识、共享记忆、Artifact 元数据 | ATM 的 file-backed 存储 |
| 模型 provider | Pi；ATX 只是可选 provider 插件 |

Neo 不再生成 `{stateDir}/runs/<runId>`、checkpoint 或 pending action。Pi 会话引用由 Neo 保存；自动化运行记录位于 `~/.atm/runs/`，具体目录可通过 ATM 配置修改。

## Neo 会话

前端通过 Neo 的 chat/session API 建立 Pi 会话。Neo 负责登录隔离、SSE 转发和 Notebook 引用映射，不复制 Pi 的完整事件日志，也不在断线后恢复一套自有执行状态机。

排查普通对话时：

1. 确认 Neo `/api/me` 可访问。
2. 检查 Neo 服务日志中的 Pi RPC 启动或协议错误。
3. 使用日志记录的 Pi session id 追踪对应会话。
4. 如果启用了 ATX，再单独检查 ATX provider；未启用时 Pi 使用自身可用 provider。

## ATM 自动化运行

ATM schedule 支持 cron、webhook 和 manual 触发。每次触发创建一个 ATM run，状态依次为 `queued`、`running`，最终进入 `succeeded`、`failed`、`timed_out`、`cancelled` 或 `skipped`。

常用命令：

```bash
atm schedule list
atm schedule run <schedule-id>
atm schedule runs
atm schedule events <run-id>
```

ATM 只保存调度级事件和 Pi session 引用，不复制 Pi token/event 流。执行目录必须位于 ATM 明确配置的 `automation.allowedWorkDirs` 下；自动任务默认只开放只读工具。

## 设置与系统状态

Web 设置页包含三个入口：

| 页面 | 用途 |
|------|------|
| Overview | 查看 Neo 登录状态与 ATM 连通性 |
| Apps | 管理用户静态应用 |
| Automations | 通过 Neo 的 `/api/atm/*` 薄代理管理 ATM schedules/runs |

ATM 连接地址由 Neo 服务端的 `ATM_HTTP_URL` 配置，只接受本机 loopback HTTP 地址。浏览器不能提交任意上游 URL。ATM 不可用时 Automations 显示边界错误，但 Chat、Notebook 和 session API 不受影响。

## 调试

- 普通对话：查看 Neo 日志中的 Pi RPC 错误和 Pi session id。
- 自动化：先运行 `atm schedule get <id>`、`atm schedule run-get <run-id>` 和 `atm schedule events <run-id>`。
- ATM 服务：确认 `atm serve` 或 `atm daemon` 正在运行，并检查 `ATM_HTTP_URL` 端口一致。
- Provider：只有显式启用 ATX 插件时才排查 ATX；否则检查 Pi 自身 provider 配置。
