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