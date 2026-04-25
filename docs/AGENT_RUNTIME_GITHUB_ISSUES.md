# Agent 运行时 GitHub Issue 模板

> 用途：提供前 5 个运行时任务的可直接发布文本，便于粘贴到 GitHub issue。
>
> 来源拆分见 [docs/AGENT_RUNTIME_ISSUES.md](./AGENT_RUNTIME_ISSUES.md)。

---

## 使用说明

- 每个模板都按 GitHub issue 正文组织
- `Title` 行可直接作为 issue 标题
- `Labels`、`Milestone`、`Blocked by` 可按你当前项目实际配置调整
- 文件引用已经尽量锚定到当前仓库实现

---

## 1. A1 定义 runtime 类型、状态机和目录约定

**Title**

```text
runtime: 定义运行时类型、状态机和目录约定
```

**Suggested Labels**

```text
area/runtime, type/architecture, priority/high
```

**Milestone**

```text
M1 Runtime Foundation
```

**Blocked by**

```text
None
```

**Body**

```markdown
## 背景

当前 Agent 执行仍然是“请求内执行”的模型，状态主要存在于调用栈和内存回调里。要把运行时演进为可恢复、可审计、可跨入口复用的模型，第一步必须先固定运行时对象、状态机和目录布局，避免后续实现阶段反复改文件格式。

相关锚点：

- [src/services/agent-runner.ts](../src/services/agent-runner.ts)
- [src/routes/chat.ts](../src/routes/chat.ts)
- [src/services/cron-agent.ts](../src/services/cron-agent.ts)
- [docs/AGENT_RUNTIME_PLAN.md](./AGENT_RUNTIME_PLAN.md)

## 目标

定义可恢复运行时的稳定数据模型，包括：

- `RunRecord`
- `RunStatus`
- `RunEvent`
- `PendingAction`
- `RunArtifact`

同时固定 `{workDir}/.neo/runs/{runId}/` 下的目录与文件约定。

## 范围

### In scope

- 新增 [src/runtime/types.ts](../src/runtime/types.ts)
- 定义状态枚举：`queued`、`running`、`waiting_confirm`、`waiting_input`、`completed`、`failed`、`cancelled`、`expired`
- 定义运行目录布局：`run.json`、`events.jsonl`、`checkpoint.json`、`pending.json`、`artifacts/`
- 给出至少 1 份 JSON 示例，说明运行时对象的最小字段集合

### Out of scope

- 不实现运行时存储读写
- 不修改 `agent-runner` 执行逻辑
- 不改 chat route、tool-confirm API 或前端协议

## 主要改动点

1. 在 [src/runtime/types.ts](../src/runtime/types.ts) 中定义运行时核心类型。
2. 固定运行目录结构，避免后续 issue 各自扩展字段。
3. 保证类型能够覆盖 Web chat、cron、后续 Telegram/webhook 入口的最小元数据。

## 完成条件

1. 类型定义能够覆盖 [src/services/agent-runner.ts](../src/services/agent-runner.ts)、[src/routes/chat.ts](../src/routes/chat.ts)、[src/services/cron-agent.ts](../src/services/cron-agent.ts) 的最小运行时需求。
2. 文档中有明确 JSON 示例，后续 issue 不需要再次发明字段。
3. 状态机与目录布局已在文档和代码中对齐。

## 验证建议

- 类型检查通过
- 文档评审通过
- 后续 A2/A3 可以直接复用这些类型而不再重复定义
```

---

## 2. A2 实现 runtime store 的 create/load/update/appendEvent 能力

**Title**

```text
runtime: 实现 runtime store 与事件追加 API
```

**Suggested Labels**

```text
area/runtime, type/backend, priority/high
```

**Milestone**

```text
M1 Runtime Foundation
```

**Blocked by**

```text
A1
```

**Body**

```markdown
## 背景

在运行时模型固定之后，下一步需要把 `run` 和 `event` 真正落盘。没有稳定的 store 层，后续的恢复、调试、SSE 重连和确认流持久化都没有锚点。

相关锚点：

- [docs/AGENT_RUNTIME_PLAN.md](./AGENT_RUNTIME_PLAN.md)
- [docs/AGENT_RUNTIME_ISSUES.md](./AGENT_RUNTIME_ISSUES.md)

## 目标

实现可复用的运行时 store 层，至少支持：

- `createRun()`
- `loadRun()`
- `saveRun()`
- `appendEvent()`
- `listRunEvents()`

并支持基于事件序号或 offset 的 cursor 读取。

## 范围

### In scope

- 新增 [src/runtime/store.ts](../src/runtime/store.ts)
- 新增 [src/runtime/events.ts](../src/runtime/events.ts)
- 为 `{workDir}/.neo/runs/{runId}/` 提供文件读写能力
- 支持追加式 `events.jsonl`
- 支持按 cursor 增量读取事件

### Out of scope

- 不改 `agent-runner` 业务流程
- 不接入 SSE
- 不处理 checkpoint 或 pending_action 的业务恢复语义

## 主要改动点

1. 实现 run 记录的创建和读取。
2. 实现事件流的稳定追加，不覆盖历史。
3. 为后续 SSE/恢复场景提供 cursor 读取能力。

## 完成条件

1. 不调用 LLM 也能创建 run 并写入 `run_created` 事件。
2. 同一 run 多次追加事件后，读取顺序稳定且不会覆盖历史事件。
3. 进程重启后仍能完整读回 run 和事件流。

## 验证建议

- 新增 runtime store 单测
- 覆盖空 run 创建、连续 append、reload 后读取三类场景
```

---

## 3. A3 实现 checkpoint 和 pending_action 的持久化存储层

**Title**

```text
runtime: 实现 checkpoint 与 pending_action 存储层
```

**Suggested Labels**

```text
area/runtime, type/backend, priority/high
```

**Milestone**

```text
M1 Runtime Foundation
```

**Blocked by**

```text
A1, A2
```

**Body**

```markdown
## 背景

运行时仅有 run 和 event 还不够。要支撑恢复执行和危险工具确认，必须把 checkpoint 和 pending_action 做成独立持久化对象，而不是继续停留在内存态。

相关锚点：

- [src/utils/pending-confirm.ts](../src/utils/pending-confirm.ts)
- [docs/AGENT_RUNTIME_PLAN.md](./AGENT_RUNTIME_PLAN.md)

## 目标

提供最小可用的 checkpoint 与 pending_action 存储层，为恢复执行与确认流升级做准备。

## 范围

### In scope

- 新增 [src/runtime/checkpoint.ts](../src/runtime/checkpoint.ts)
- 新增 [src/runtime/pending-actions.ts](../src/runtime/pending-actions.ts)
- 实现 `saveCheckpoint()`、`loadCheckpoint()`
- 实现 `savePendingAction()`、`resolvePendingAction()`
- 约定 timeout、resolvedAt、resolution 等字段

### Out of scope

- 不在这一项里改造 `tool-confirm` API
- 不实现启动恢复扫描
- 不接线前端 Confirm 流程

## 主要改动点

1. 将 checkpoint 定义为可覆盖写的快照文件。
2. 将 pending_action 定义为可单独读取和解析的持久化对象。
3. 为后续 `waiting_confirm` 和 `resumeRun()` 铺平存储基础。

## 完成条件

1. checkpoint 可覆盖写，pending_action 可单独读写。
2. 同一 run 下支持至少一个未决确认动作和一个最近 checkpoint。
3. A3 完成后，后续 C1 可以直接基于 pending_action 改造确认流。

## 验证建议

- 新增 checkpoint/pending-action 单测
- 覆盖保存、读取、覆盖更新、已解决动作写回场景
```

---

## 4. B1 重构 agent-runner，分离 prepareRunContext、executeRunLoop、resumeRun

**Title**

```text
runtime: 重构 agent-runner，拆分 prepare/execute/resume 三段
```

**Suggested Labels**

```text
area/runtime, area/agent, type/refactor, priority/high
```

**Milestone**

```text
M2 Evented Executor
```

**Blocked by**

```text
A2, A3
```

**Body**

```markdown
## 背景

当前 [src/services/agent-runner.ts](../src/services/agent-runner.ts) 仍然是单函数串行执行模型：加载用户、准备 session、读取历史、调用 LLM、保存 assistant 消息全部在一个流程中完成。这种结构不利于注入 runtime store、写 checkpoint 和实现 resume。

## 目标

把 `agent-runner` 重构为可恢复执行骨架，至少拆成：

- `prepareRunContext()`
- `executeRunLoop()`
- `resumeRun()`

同时保留现有 `runAgentTurn()` 兼容入口。

## 范围

### In scope

- 重构 [src/services/agent-runner.ts](../src/services/agent-runner.ts)
- 新增或引入 [src/runtime/executor.ts](../src/runtime/executor.ts)
- 将用户上下文装配、history 读取、消息持久化、LLM 调用从单个函数中分层
- 让执行器内部能接受 `runId` 和 runtime store

### Out of scope

- 不在这一项里补齐所有 runtime events
- 不改 chat route 的 SSE 协议
- 不改前端

## 主要改动点

1. 把现有线性执行流程拆成可测试的阶段函数。
2. 确保 `runAgentTurn()` 仍可作为兼容入口被当前 Web chat、Telegram、cron 调用。
3. 为后续事件发射与恢复逻辑提供明确插入点。

## 完成条件

1. `runAgentTurn()` 仍保持兼容签名。
2. 执行器内部已经能接受 `runId` 和 store，而不再只依赖局部变量。
3. 后续 B2/B3 不需要再大拆一次 `agent-runner` 结构。

## 验证建议

- 保持现有 agent-runner 测试通过
- 补 prepare/execute 层的窄单测或集成测试
```

---

## 5. B2 在执行器关键节点补齐 runtime events

**Title**

```text
runtime: 在 agent 执行关键节点补齐 runtime events
```

**Suggested Labels**

```text
area/runtime, area/agent, type/backend, priority/high
```

**Milestone**

```text
M2 Evented Executor
```

**Blocked by**

```text
B1
```

**Body**

```markdown
## 背景

运行时要真正可追踪，事件流必须成为事实源，而不是只在 SSE 里瞬时出现文本和工具输出。当前 `agent-runner` 已经有模型路由、消息写入、chunk 回调、todo 和 artifact 回调，这些节点正好是 runtime events 的首批落点。

相关锚点：

- [src/services/agent-runner.ts](../src/services/agent-runner.ts)
- [src/routes/chat.ts](../src/routes/chat.ts)

## 目标

在执行器关键节点补齐首批运行时事件：

- `route_resolved`
- `user_message_saved`
- `llm_chunk`
- `tool_call_started`
- `tool_call_finished`
- `todo_updated`
- `artifact_created`
- `run_completed`
- `run_failed`

## 范围

### In scope

- 在 [src/services/agent-runner.ts](../src/services/agent-runner.ts) 发模型路由和消息事件
- 在 LLM chunk 回调处发 `llm_chunk`
- 在工具执行路径补工具开始/结束事件
- 在 todo 和 artifact 回调处发事件
- 为事件 payload 约定最小字段集

### Out of scope

- 不改 SSE 协议桥接层
- 不做 cursor 重连
- 不在这一项里处理确认流持久化

## 主要改动点

1. 让一次对话结束后 run 目录中出现完整的事件轨迹。
2. 让工具调用和产物不再只存在于 SSE 瞬时输出里。
3. 为后续 D2 的 chat route 桥接和 E1 的前端 run-aware 消费铺路。

## 完成条件

1. 单次对话至少能落下：`run_created`、`run_started`、`route_resolved`、`user_message_saved`、若干 `llm_chunk`、`run_completed`。
2. 工具调用和产物不再只存在于 SSE 瞬时流中。
3. 异常路径会记录 `run_failed`，而不是仅抛错结束。

## 验证建议

- 新增执行器事件单测
- 跑一次带工具调用的对话，确认事件文件中存在工具开始/结束与 todo/artifact 事件
```

---

## 6. B3 记录执行 checkpoint，并支持从 checkpoint 恢复 run

**Title**

```text
runtime: 记录执行 checkpoint，并支持从 checkpoint 恢复 run
```

**Suggested Labels**

```text
area/runtime, type/backend, priority/high
```

**Milestone**

```text
M2 Evented Executor
```

**Blocked by**

```text
B2
```

**Body**

```markdown
## 背景

在执行器已经具备事件发射能力后，还需要引入 checkpoint，才能支撑恢复执行和中断后的继续处理。否则 run 即使有事件流，也仍然缺少明确的恢复锚点。

## 目标

记录执行过程中的最小 checkpoint，并提供 `resumeRun(runId)` 能力。

## 范围

### In scope

- 在 [src/services/agent-runner.ts](../src/services/agent-runner.ts) 或 [src/runtime/executor.ts](../src/runtime/executor.ts) 中记录 `fullResponse`、history cursor、当前阶段、最近工具步骤
- 实现 `resumeRun(runId)`
- 约定 checkpoint 刷新时机，避免 chunk 级别频繁写盘

### Out of scope

- 不做启动自动扫描恢复
- 不改前端协议

## 主要改动点

1. 为 `running` 和 `waiting_confirm` 的 run 提供明确的恢复点。
2. 将恢复逻辑从 route 层剥离，归到 runtime executor。

## 完成条件

1. 运行中途可以读取最近 checkpoint。
2. 对 `waiting_confirm` 或可恢复的 `running` 状态，存在明确的 resume 入口。

## 验证建议

- 补 checkpoint 与 resume 测试
- 模拟中断后恢复并继续完成 run
```

---

## 7. C1 将危险工具确认从内存 Map 改为持久化 pending_action

**Title**

```text
runtime: 将危险工具确认从内存 Map 改为持久化 pending_action
```

**Suggested Labels**

```text
area/runtime, area/tools, priority/high
```

**Milestone**

```text
M3 Runtime Integration
```

**Blocked by**

```text
A3, B2
```

**Body**

```markdown
## 背景

当前 [src/utils/pending-confirm.ts](../src/utils/pending-confirm.ts) 仍是纯内存确认注册表，服务重启或连接中断后待确认状态会丢失。这是运行时从“函数式调用”升级为“可恢复执行”时必须先补掉的缺口。

## 目标

使用 `pending_action` 替换内存确认注册表，让危险工具确认具备持久化和可恢复能力。

## 范围

### In scope

- 调整 [src/utils/pending-confirm.ts](../src/utils/pending-confirm.ts) 为 runtime-backed 实现，或由 runtime 模块取代
- 在确认触发时写入 `confirm_requested` 事件和 `pending_action`
- 更新 run.status 为 `waiting_confirm`

### Out of scope

- 不改前端确认协议
- 不做 timeout sweep

## 主要改动点

1. 待确认动作不再只保存在内存中。
2. SSE 断开或进程重启后，确认动作仍可重新读取。

## 完成条件

1. 未决确认不再只保存在内存 Map。
2. 即使 SSE 断开，待确认动作仍可重新读取。

## 验证建议

- 补 pending_action 持久化测试
- 模拟确认前服务重启，确认动作仍可找回
```

---

## 8. C2 将 tool-confirm 从 confirmId 改为 runId/actionId 协议

**Title**

```text
runtime: 将 tool-confirm 从 confirmId 改为 runId/actionId 协议
```

**Suggested Labels**

```text
area/runtime, area/web, area/api, priority/high
```

**Milestone**

```text
M3 Runtime Integration
```

**Blocked by**

```text
C1
```

**Body**

```markdown
## 背景

当确认流变成 runtime-backed 之后，现有 `confirmId` 协议已经不再适合表达持久化动作，服务端与前端都需要切换到 `runId/actionId` 作为主标识。

相关锚点：

- [src/routes/tool-confirm.ts](../src/routes/tool-confirm.ts)
- [web/src/api.ts](../web/src/api.ts)
- [web/src/components/ChatArea.tsx](../web/src/components/ChatArea.tsx)

## 目标

让确认接口和前端 activity log 以 `runId/actionId` 为主键，彻底摆脱内存 `confirmId`。

## 范围

### In scope

- 改造 [src/routes/tool-confirm.ts](../src/routes/tool-confirm.ts)
- 改造 [web/src/api.ts](../web/src/api.ts) 中的 `confirmTool()`
- 改造 [web/src/types/index.ts](../web/src/types/index.ts) 的 `tool_confirm` 结构
- 改造 [web/src/components/ChatArea.tsx](../web/src/components/ChatArea.tsx) 的 Approve/Deny 流程

### Out of scope

- 不在这一项里实现 SSE 重连

## 主要改动点

1. 前后端共享同一套动作标识。
2. 前端 activity log 能稳定追踪确认动作状态。

## 完成条件

1. 前端 activity log 能保存 `runId`、`actionId`、确认状态。
2. 服务端可在不依赖内存 `confirmId` 的情况下解析用户决策。

## 验证建议

- 补 chat route / ChatArea 的确认流测试
- 手动验证 Approve/Deny 后 activity log 状态正确更新
```

---

## 9. C3 实现 waiting_confirm 和半完成 run 的 timeout/recovery 收敛逻辑

**Title**

```text
runtime: 实现 waiting_confirm 和半完成 run 的收敛逻辑
```

**Suggested Labels**

```text
area/runtime, type/backend, priority/medium
```

**Milestone**

```text
M4 Recovery And Ops
```

**Blocked by**

```text
B3, C1
```

**Body**

```markdown
## 背景

即使确认动作持久化了，如果缺少 timeout/recovery 收敛器，系统仍会留下无限期挂起的 run。运行时要可运营，必须能主动收敛异常中断或超时状态。

## 目标

实现 `waiting_confirm` 和异常中断 `running` run 的收敛逻辑。

## 范围

### In scope

- 启动时扫描 `.neo/runs/`
- 对过期 pending_action 生成 `confirm_resolved` 事件并自动拒绝
- 对异常退出遗留的 `running` run 做失败或可恢复收敛

### Out of scope

- 不做新的前端 UI

## 主要改动点

1. 防止 run 永久悬挂。
2. 让重启后的系统自动把脏状态收敛到确定结果。

## 完成条件

1. 超时确认会把 run 推进到确定状态。
2. 服务重启后，不会留下无限期的 `waiting_confirm` 或僵尸 `running` run。

## 验证建议

- 增加启动恢复测试
- 模拟过期确认和异常退出场景
```

---

## 10. D1 新增 runs API：详情、事件流、列表、取消

**Title**

```text
runtime: 新增 runs API（详情、事件流、列表、取消）
```

**Suggested Labels**

```text
area/runtime, area/api, priority/high
```

**Milestone**

```text
M3 Runtime Integration
```

**Blocked by**

```text
A2, A3
```

**Body**

```markdown
## 背景

运行时真正成为系统对象之前，需要一组显式的查询与控制 API。否则 route 与前端仍只能通过临时 SSE 流观察执行结果。

## 目标

新增 runs 相关 API：详情、事件流、列表与取消。

## 范围

### In scope

- 新增 [src/routes/runs.ts](../src/routes/runs.ts)
- 提供 `GET /api/runs/:id`、`GET /api/runs/:id/events`、`GET /api/runs`、`POST /api/runs/:id/cancel`
- 复用 runtime store 与 event reader

### Out of scope

- 不要求本项就有完整前端页面

## 主要改动点

1. 提供不依赖 chat SSE 的 run 查询方式。
2. 为后续调试面板和前端重连提供稳定 API。

## 完成条件

1. 可以不走聊天 SSE，直接按 runId 查看状态与事件。
2. cancel API 能更新 run 状态并触发执行中止。

## 验证建议

- 增加 runs route 测试
- 手动创建 run 后通过 API 读取详情和事件
```

---

## 11. D2 将 chat route 改为“创建 run + 桥接事件到 SSE”

**Title**

```text
runtime: 重构 chat route，为 runtime event SSE 桥接层
```

**Suggested Labels**

```text
area/runtime, area/chat, area/api, priority/high
```

**Milestone**

```text
M3 Runtime Integration
```

**Blocked by**

```text
B2, D1
```

**Body**

```markdown
## 背景

当前 [src/routes/chat.ts](../src/routes/chat.ts) 仍是“请求进来 -> 直接执行 -> SSE 回写”的模型。要让运行时真正成为一等对象，chat route 必须退化成“run 创建 + event 桥接”。

## 目标

让 chat route 从执行入口降为运行时桥接层。

## 范围

### In scope

- 改造 [src/routes/chat.ts](../src/routes/chat.ts)
- 复用 [src/utils/sse.ts](../src/utils/sse.ts)
- 在创建 run 后，把运行时事件映射为现有 `text/tool_call/tool_result/tool_confirm/todo_update/done/error` SSE chunk

### Out of scope

- 不同时改 notebook chat
- 第一步不要求前端协议变化

## 主要改动点

1. SSE 只负责消费和桥接 event stream。
2. 客户端断线不会直接把 run 判定为失败。

## 完成条件

1. 前端协议在第一步可以保持兼容。
2. SSE 断开不会自动让 run 失败。
3. 路由层不再持有主要执行状态。

## 验证建议

- 补 chat route 测试
- 模拟客户端断线，确认 run 仍继续执行或被明确中止
```

---

## 12. D3 将 cron / Telegram / webhook 入口统一到 runtime run model

**Title**

```text
runtime: 统一 cron、Telegram 和 webhook 到 runtime 入口
```

**Suggested Labels**

```text
area/runtime, area/integration, priority/medium
```

**Milestone**

```text
M4 Recovery And Ops
```

**Blocked by**

```text
D2
```

**Body**

```markdown
## 背景

运行时若只覆盖 Web chat，系统仍然会保留多套执行模型。要真正统一语义，cron、Telegram 和 webhook 入口都必须创建同一种 run。

## 目标

统一异步入口到 runtime run model，并补齐入口元数据。

## 范围

### In scope

- 改造 [src/services/cron-agent.ts](../src/services/cron-agent.ts)
- 改造 [src/platforms/telegram-bot.ts](../src/platforms/telegram-bot.ts)
- 检查 [src/routes/webhook.ts](../src/routes/webhook.ts)
- 为 run 增加 `entrypoint`、`triggerType`、`parentRunId`、`sessionId` 等元数据

### Out of scope

- 不要求本项提供统一 UI 面板

## 主要改动点

1. 所有异步入口共享同一运行模型。
2. 后台任务、聊天任务和 webhook 任务都能在统一 run 列表中查看。

## 完成条件

1. cron 与 Telegram 触发的任务都能产出 run 记录。
2. 入口层主要负责鉴权和结果消费，不再自己拼执行语义。

## 验证建议

- 先补 cron integration，再扩 Telegram/webhook
- 手动触发后台任务，确认 run 记录完整
```

---

## 13. E1 让 Web 前端识别 runId/actionId/cursor，并支持事件重连

**Title**

```text
runtime: 让 Web 前端支持 runId/actionId/cursor 与事件重连
```

**Suggested Labels**

```text
area/runtime, area/web, priority/high
```

**Milestone**

```text
M4 Recovery And Ops
```

**Blocked by**

```text
C2, D2
```

**Body**

```markdown
## 背景

当前 Web 前端仍把自己当作“单次流式消息消费者”。一旦 chat route 和确认流都 runtime 化，前端也必须升级为“运行时事件消费者”。

相关锚点：

- [web/src/api.ts](../web/src/api.ts)
- [web/src/lib/stream-transport.ts](../web/src/lib/stream-transport.ts)
- [web/src/components/ChatArea.tsx](../web/src/components/ChatArea.tsx)
- [web/src/stores/slices/chatSlice.ts](../web/src/stores/slices/chatSlice.ts)

## 目标

让 Web 前端识别 `runId`、`actionId` 和 `cursor`，并在 SSE 中断后支持事件重连。

## 范围

### In scope

- 改造 [web/src/api.ts](../web/src/api.ts) 的 `streamChat()` 和 `confirmTool()`
- 改造 [web/src/lib/stream-transport.ts](../web/src/lib/stream-transport.ts)
- 改造 [web/src/components/ChatArea.tsx](../web/src/components/ChatArea.tsx)
- 改造 [web/src/stores/slices/chatSlice.ts](../web/src/stores/slices/chatSlice.ts)

### Out of scope

- 不扩散到 Notebook 面板

## 主要改动点

1. activity log 记录的确认项能映射到具体 run/action。
2. 前端拥有最小事件重连能力。

## 完成条件

1. 前端 activity log 记录的确认项可映射到具体 run/action。
2. SSE 断开后，客户端至少具备从最新 cursor 继续追事件的能力。

## 验证建议

- 增加前端/路由集成测试
- 手动断开 SSE，再验证能继续追事件
```

---

## 14. E2 补齐 runtime store、resume、confirm、SSE reconnect 测试

**Title**

```text
runtime: 补齐 runtime store、resume、confirm、SSE reconnect 测试
```

**Suggested Labels**

```text
area/runtime, area/tests, priority/high
```

**Milestone**

```text
M4 Recovery And Ops
```

**Blocked by**

```text
A2, B3, C2, D2
```

**Body**

```markdown
## 背景

运行时重构会把执行链从函数式流程变成状态机 + 事件流。如果不尽早补齐专门测试矩阵，后续每个阶段都会靠手动回归，风险会快速放大。

## 目标

补齐 runtime store、resume、confirm、SSE reconnect 等关键场景的自动化测试。

## 范围

### In scope

- 新增 `src/runtime/__tests__/` 测试目录
- 补 `store`、`events`、`checkpoint`、`pending-action` 单测
- 补 [src/services/__tests__/agent-runner.test.ts](../src/services/__tests__/agent-runner.test.ts) 的 runtime 版本用例
- 补 [src/routes/__tests__/chat.test.ts](../src/routes/__tests__/chat.test.ts) 的 SSE reconnect / confirm 路径

### Out of scope

- 不要求本项一开始就覆盖所有平台入口

## 主要改动点

1. 建立运行时回归网。
2. 覆盖重启恢复和 SSE 重连这两类最容易回归的场景。

## 完成条件

1. 可验证 run 创建、事件追加、确认超时、resume、SSE 事件桥接。
2. 至少覆盖一个“服务重启后恢复 waiting_confirm”的场景。

## 验证建议

- 运行完整 runtime 测试集
- 在 CI 中纳入这些新测试
```

---

## 15. E3 记录 runtime 指标并提供调试查看入口

**Title**

```text
runtime: 记录运行时指标并提供调试查看入口
```

**Suggested Labels**

```text
area/runtime, area/observability, priority/medium
```

**Milestone**

```text
M4 Recovery And Ops
```

**Blocked by**

```text
D1, D2
```

**Body**

```markdown
## 背景

运行时一旦上线，如果没有指标和调试入口，问题排查成本会非常高。最低限度需要记录耗时、工具调用、fallback 与等待确认时间，并能按 runId 快速定位问题。

## 目标

补齐最小运行时观测能力，并提供调试查看入口。

## 范围

### In scope

- 为 run 记录总耗时、工具数、fallback 次数、等待确认耗时
- 接入现有日志体系，如 [src/utils/logger.ts](../src/utils/logger.ts)
- 视需要补 run 列表简易调试接口或后台页占位

### Out of scope

- 不强求首版就提供完整运维面板

## 主要改动点

1. 指标、日志和事件流三者围绕 `runId` 对齐。
2. 最低限度做到“能查到、能看懂、能关联”。

## 完成条件

1. 单个 run 的关键指标可以被结构化读取。
2. 出问题时能按 runId 从日志和事件流定位问题。

## 验证建议

- 手动执行一条 run，确认指标和日志包含 runId
- 校验 API 或调试入口可以查看关键字段
```

## 完成条件

1. 单次对话至少能落下：`run_created`、`run_started`、`route_resolved`、`user_message_saved`、若干 `llm_chunk`、`run_completed`。
2. 工具调用和产物不再只存在于 SSE 瞬时流中。
3. 异常路径会记录 `run_failed`，而不是仅抛错结束。

## 验证建议

- 新增执行器事件单测
- 跑一次带工具调用的对话，确认事件文件中存在工具开始/结束与 todo/artifact 事件
```