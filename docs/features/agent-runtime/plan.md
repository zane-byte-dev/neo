# Agent 运行时演进任务清单

> 目标：把当前“单次请求内完成一次 agent turn”的执行模型，升级为可恢复、可审计、可跨入口复用的运行时。
>
> 最后更新：2026-04-27

配套 issue 拆分见：[issues.md](issues.md)

> 实施状态快照（2026-04-27）
>
> - 已完成：Phase 0 持久化底座、Phase 1 `prepareRunContext/executeRunLoop/resumeRun` 骨架、文本型 `resumeRun()` 恢复入口、Phase 2 确认流持久化与批准后自动恢复、Phase 3 各入口统一到 runtime run model、Phase 4 runs API 与 sweeper 收敛、chat route 的 runtime-event SSE 桥接、Web 端基于 cursor 的事件重连
> - 部分完成：更细粒度的 runtime 指标与运维观测仍可继续补强
> - 未完成：前端 reconnect 的专门自动化测试、后台入口更丰富的 artifact 分发策略

---

## 一、当前状态

当前的核心执行链路已经可用，但它仍然是“请求内执行”的模型：

- [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts) 负责一次完整的 user -> assistant turn
- [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts) 通过 SSE 把流式 chunk 直接推给前端
- [src/services/cron-agent.ts](../../../packages/app/src/services/cron-agent.ts) 通过构造新的 `sessionId` 触发后台任务
- [src/utils/pending-confirm.ts](../../../packages/app/src/utils/pending-confirm.ts) 用内存 Map 暂存危险工具确认状态
- [src/routes/tool-confirm.ts](../../../packages/app/src/routes/tool-confirm.ts) 仅能解析当前进程内仍然存活的确认请求

这个模型的优点是简单，已经足够支撑即时对话；但它有几个明显上限：

1. 进程重启后，确认状态、待恢复任务和运行中上下文都会丢失。
2. 长任务无法暂停、恢复、重放，也没有统一的运行审计面。
3. Web、Telegram、Webhook、cron 复用了同一套 LLM 逻辑，但没有复用同一套“运行时状态模型”。
4. SSE 断线后，前端只能视为一次失败，无法从事件游标继续追状态。

---

## 二、目标与边界

### 目标

1. 让 Agent 执行具备持久化 run 状态，而不是只存在于一次 HTTP 请求里。
2. 让工具确认、后台任务、长任务恢复都建立在同一套运行时对象之上。
3. 保持现有聊天会话、Notebook、Telegram 入口兼容，不一次性推翻现有文件存储。
4. 为后续工作流、多 Agent、评测与审计日志打基础。

### 非目标

1. 这一阶段不直接实现多 Agent 编排。
2. 不在第一阶段引入新的外部任务队列或分布式基础设施。
3. 不强依赖数据库；运行时持久化可先基于文件事件日志落地。

---

## 三、目标形态

### 3.1 运行时实体

建议把一次 Agent 执行拆成以下对象：

| 对象 | 作用 | 建议持久化 |
|------|------|-----------|
| `run` | 一次完整执行的顶层对象 | `run.json` |
| `event` | 追加式事件流，记录状态迁移和中间输出 | `events.jsonl` |
| `checkpoint` | 可恢复状态快照 | `checkpoint.json` |
| `pending_action` | 等待用户或系统决策的阻塞点 | `pending.json` |
| `artifact` | 图片、文件、导出物、结构化结果 | `artifacts/` + 元数据 |

建议的目录形态：

```text
{stateDir}/runs/{runId}/
  run.json
  events.jsonl
  checkpoint.json
  pending.json
  artifacts/
```

### 3.2 状态机

`run.status` 建议至少包含：

- `queued`
- `running`
- `waiting_confirm`
- `waiting_input`
- `completed`
- `failed`
- `cancelled`
- `expired`

状态流转示意：

```text
queued -> running -> completed
                 -> failed
                 -> cancelled
                 -> waiting_confirm -> running
                 -> waiting_input   -> running
```

### 3.3 事件模型

运行时必须以事件为准，而不是以内存变量为准。建议首批事件类型：

- `run_created`
- `run_started`
- `route_resolved`
- `user_message_saved`
- `llm_chunk`
- `tool_call_started`
- `tool_call_finished`
- `todo_updated`
- `artifact_created`
- `confirm_requested`
- `confirm_resolved`
- `run_completed`
- `run_failed`

这样做的原因很直接：

1. SSE 可以从事件流读取，而不是直接绑定执行器内存。
2. 断线重连、调试回放、问题追踪都统一读取事件流。
3. 后续 Telegram、Webhook、后台 worker 也可以消费相同事件。

### 3.4 最小 JSON 示例

对应代码定义见 [src/runtime/types.ts](../../../packages/runtime/src/types.ts)。

`run.json` 最小示例：

```json
{
  "id": "run_20260425_001",
  "userId": "alice",
  "status": "queued",
  "entrypoint": "web-chat",
  "triggerType": "user_message",
  "createdAt": "2026-04-25T10:00:00.000Z",
  "updatedAt": "2026-04-25T10:00:00.000Z",
  "sessionId": "sess_123",
  "request": {
    "message": "帮我总结今天的工作重点",
    "model": "auto",
    "imageCount": 0,
    "documentCount": 0
  }
}
```

`events.jsonl` 最小示例：

```json
{"id":"evt_1","runId":"run_20260425_001","index":0,"type":"run_created","ts":"2026-04-25T10:00:00.000Z","payload":{"status":"queued","entrypoint":"web-chat","triggerType":"user_message"}}
{"id":"evt_2","runId":"run_20260425_001","index":1,"type":"route_resolved","ts":"2026-04-25T10:00:01.000Z","payload":{"model":"gemini-acp","tier":"standard","score":0.62,"confidence":0.91}}
```

`pending.json` 最小示例：

```json
{
  "id": "action_approve_tool_1",
  "runId": "run_20260425_001",
  "type": "tool_confirmation",
  "status": "pending",
  "createdAt": "2026-04-25T10:00:03.000Z",
  "updatedAt": "2026-04-25T10:00:03.000Z",
  "expiresAt": "2026-04-25T10:01:03.000Z",
  "request": {
    "toolName": "bash",
    "args": {
      "command": "rm -rf /tmp/demo"
    }
  }
}
```

---

## 四、实施阶段

## Phase 0：抽出运行时存储层

目标：先把“状态写下来”，不急着改所有入口。

状态：已完成。

建议新增：

- `src/runtime/types.ts`
- `src/runtime/store.ts`
- `src/runtime/events.ts`
- `src/runtime/checkpoint.ts`

任务清单：

1. [x] 定义 `RunRecord`、`RunEvent`、`PendingAction`、`RunArtifact` 类型。
2. [x] 提供 `createRun()`、`appendEvent()`、`updateRunStatus()`、`saveCheckpoint()`、`loadRun()` API。
3. [x] 约定 run 目录布局与文件格式，全部采用追加写或小文件覆盖写。
4. [x] 为事件流提供 cursor 语义，支持“从第 N 条事件之后继续读取”。

验收标准：

1. 不依赖 LLM 即可创建一个空 run，并产生事件文件。
2. 进程重启后，已有 run 仍能被重新读取。

## Phase 1：把 `agent-runner` 改为事件驱动执行器

目标：保留现有调用方式，但内部改成“写事件 + 更新 checkpoint”。

状态：已完成事件化、checkpoint 写盘，以及 `prepareRunContext()/executeRunLoop()/resumeRun()` 三段骨架。

任务清单：

1. [x] 将 [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts) 拆成：
   - `prepareRunContext()`
   - `executeRunLoop()`
   - `resumeRun()`
2. [x] 在模型路由、消息写入、LLM chunk、工具调用、todo 更新处统一发事件。
3. [x] 将 `fullResponse`、history cursor、当前工具步骤等关键状态写入 checkpoint。
4. [x] 保持现有 `runAgentTurn()` 作为兼容入口，但其内部委托给新的 runtime executor。

验收标准：

1. 现有 [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts) 无需改协议即可继续工作。
2. 单次 turn 执行完成后，run 目录中可看到完整事件流和最终状态。

## Phase 2：把工具确认从内存态改为持久化阻塞点

目标：解决当前 [src/utils/pending-confirm.ts](../../../packages/app/src/utils/pending-confirm.ts) 仅在单进程内有效的问题。

状态：已完成持久化确认对象、运行时事件接线，以及磁盘态批准后的自动恢复执行。

任务清单：

1. [x] 用 `pending_action` 替代纯内存 Map，保留内存索引只作性能缓存。
2. [x] `confirm_requested` 事件写入 run，并把 `run.status` 改为 `waiting_confirm`。
3. [x] [src/routes/tool-confirm.ts](../../../packages/app/src/routes/tool-confirm.ts) 改为基于 `runId/actionId` 定位，而不是仅靠内存 `confirmId`。
4. [x] 超时、拒绝、断线都统一走 `confirm_resolved` 事件，并恢复执行或结束 run。

验收标准：

1. 触发危险工具确认后，刷新前端或重启进程，确认请求仍可被找回。
2. 超时拒绝后，run 会落成确定状态，不会悬挂。

## Phase 3：统一所有入口到同一运行时

目标：让 Web、Telegram、Webhook、cron 全部创建同一种 run。

状态：已完成。chat 已切到“创建 run + 桥接 runtime events 到 SSE”，Web 端已支持基于 `runId/cursor` 的事件追补，cron / Telegram / webhook 也已消费 `run_completed` 与 `artifact_created` 结果。

任务清单：

1. [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts) 改为“创建 run + 订阅事件流”。
2. [src/services/cron-agent.ts](../../../packages/app/src/services/cron-agent.ts) 不再直接只关心返回文本，而是消费 `run_completed` 事件和产物。
3. Telegram 和 webhook 入口增加 `entrypoint` 元数据，区分来源，并在完成后读取 runtime outcome。
4. 将 `sessionId`、`notebook`、`triggerType`、`parentRunId` 纳入 run 元数据，便于审计与追踪。

验收标准：

1. 同一条后台任务与 Web 发起的任务都能在统一 run 模型中查看。
2. 入口层代码主要负责鉴权、参数整理和事件消费，不再持有执行状态。

## Phase 4：恢复、取消与运维能力

目标：让运行时真的可运营，而不是只是“多写了几份文件”。

状态：已完成 sweeper、runs 查询接口与 cancel 控制面；更细粒度的运行时指标仍可继续补强。

任务清单：

1. [x] 启动时扫描 `queued/running/waiting_*` 的 run，执行恢复或超时收敛。
2. [x] 增加 cancel API，把 `AbortSignal` 和 run 状态统一起来。
3. [x] 增加 run 列表、run 详情、事件尾部读取接口。
4. [ ] 记录运行时指标：总耗时、工具次数、fallback 次数、等待确认耗时。

验收标准：

1. 服务重启后，未完成 run 会被自动收敛为恢复或失败，不会永久卡死。
2. 前端或调试脚本可以按 runId 查看完整事件序列。

---

## 五、API 与前端改造建议

### 5.1 后端 API

建议补这几类接口：

- `POST /api/runs`：创建 run
- `GET /api/runs/:id`：获取 run 状态
- `GET /api/runs/:id/events?cursor=N`：增量读取事件
- `POST /api/runs/:id/cancel`：取消 run
- `POST /api/runs/:id/actions/:actionId`：确认/拒绝 pending action

现有 [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts) 可以继续保留，但其职责应收敛为：

1. 创建 run
2. 将事件桥接到 SSE
3. 在客户端断线时停止当前订阅，而不是把 run 本身视为失败

### 5.2 前端行为

前端现已从“单次文本流”升级为“run-aware 事件消费者”：

1. 首屏先接收 `runId`，并在聊天流中记录 `cursor`。
2. 工具调用、todo、确认、artifact 都可由 runtime events 追补。
3. SSE 断开后，客户端会回退到 `/api/runs/:id/events?cursor=N` 继续追事件。

---

## 六、测试清单

建议新增或补强以下测试：

1. runtime store：创建 run、追加事件、重启后读取
2. runtime resume：在 `waiting_confirm` 或 `running` 中途恢复
3. tool confirm：确认、拒绝、超时三种分支
4. SSE reconnect：同一个 run 能从 cursor 继续读事件
5. cron / webhook integration：后台任务与程序化入口完成后能消费 artifact 和最终文本

---

## 七、推荐实施顺序

如果只做最小可用版本，建议按这个顺序推进：

1. 先做 `run/event/checkpoint` 的文件持久化
2. 再改 `agent-runner` 内部发事件
3. 再把 `tool-confirm` 从内存态改为持久化阻塞点
4. 最后统一 chat / cron / telegram / webhook 入口

原因是：先持久化事件，后续所有“恢复、调试、重连、审计”能力才有锚点；否则只是继续在现有请求模型上打补丁。