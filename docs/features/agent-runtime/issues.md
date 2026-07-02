# Agent 运行时 Issue 拆分

> 目标：把 [plan.md](plan.md) 拆成可直接进入排期、PR 和 issue 系统的工作项。
>
> 最后更新：2026-04-27

前 5 个 issue 的可直接发布文本见：[github-issues.md](github-issues.md)

> 当前完成情况（2026-04-27）
>
> - [x] A1. 定义运行时类型与目录布局
> - [x] A2. 实现运行时 store 与事件追加 API
> - [x] A3. 实现 checkpoint 与 pending_action 存储
> - [x] B1. 将执行器彻底拆成 prepare / execute / resume 三段
> - [x] B2. 为模型路由、消息、chunk、工具和 todo 发运行时事件
> - [x] B3. 独立 `resumeRun(runId)` 恢复路径
> - [x] C1. 用 pending_action 替换内存确认注册表
> - [x] C2. 改造工具确认 API 与协议，支持 `runId/actionId`
> - [x] C3. 实现确认超时与未完成 run sweeper
> - [x] D1. 增加 runs 查询与控制 API
> - [x] D2. chat route 改为基于 runtime events 的 SSE 桥接
> - [x] D3. cron / Telegram / webhook 写入统一 run 元数据
> - [x] E1. 前端基于 cursor 的事件消费与重连
> - [ ] E2. 覆盖 resume / SSE reconnect 的完整测试矩阵

---

## 一、使用方式

这份清单按“Epic -> Issue”组织，每个 issue 都尽量贴着当前代码入口来写，方便直接转成 GitHub issue 或项目看板卡片。

建议字段映射：

- 标题：直接使用 issue 标题
- 描述：复制“目标 + 主要改动点”
- 验收标准：复制“完成条件”
- 依赖：转成 blocked by / relates to

---

## 二、建议分组

### Epic A：运行时持久化基础

目标：先把 `run / event / checkpoint / pending_action` 的文件模型立起来。

### Epic B：事件驱动执行器

目标：把 [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts) 从“直接执行”改成“写事件 + 更新 checkpoint”。

### Epic C：确认流与恢复机制

目标：替换当前 [src/utils/pending-confirm.ts](../../../packages/app/src/utils/pending-confirm.ts) 的内存态确认逻辑，并补恢复能力。

### Epic D：统一入口与 API

目标：让 [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts)、[src/services/cron-agent.ts](../../../packages/app/src/services/cron-agent.ts)、Telegram、Webhook 都复用同一运行时。

### Epic E：前端接线、测试与运维

目标：把运行时变成真正可消费、可调试、可回归验证的系统。

---

## 三、Issue 清单

## A1. 定义运行时类型与目录布局

状态：已完成。

**标题**：定义 runtime 类型、状态机和目录约定

**目标**：为可恢复运行时提供稳定的数据模型，避免后续实现过程中反复改文件格式。

**主要改动点**：

- 新增 [src/runtime/types.ts](../../../packages/runtime/src/types.ts)
- 约定 `{stateDir}/runs/{runId}/run.json`、`events.jsonl`、`checkpoint.json`、`pending.json`、`artifacts/`
- 定义 `RunRecord`、`RunStatus`、`RunEvent`、`PendingAction`、`RunArtifact`
- 固化 `queued/running/waiting_confirm/waiting_input/completed/failed/cancelled/expired` 状态枚举

**依赖**：无

**完成条件**：

1. 类型定义能够覆盖 [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts)、[src/routes/chat.ts](../../../packages/app/src/routes/chat.ts)、[src/services/cron-agent.ts](../../../packages/app/src/services/cron-agent.ts) 需要的最小元数据。
2. 有明确的 JSON 示例，后续 issue 不再各自发明字段。

**建议 PR 范围**：只包含类型、目录约定和文档，不引入执行逻辑。

## A2. 实现运行时 store 与事件追加 API

状态：已完成。

**标题**：实现 runtime store 的 create/load/update/appendEvent 能力

**目标**：把运行时落盘能力做成可复用底座。

**主要改动点**：

- 新增 [src/runtime/store.ts](../../../packages/runtime/src/store.ts)
- 新增 [src/runtime/events.ts](../../../packages/runtime/src/events.ts)
- 实现 `createRun()`、`loadRun()`、`saveRun()`、`appendEvent()`、`listRunEvents()`
- 支持基于事件序号或 offset 的 cursor 读取

**依赖**：A1

**完成条件**：

1. 不调用 LLM 也能创建 run 并写入 `run_created` 事件。
2. 同一 run 多次追加事件后，读取顺序稳定且不会覆盖历史事件。
3. 进程重启后仍能完整读回 run 和事件流。

**建议 PR 范围**：只做文件存储与读取，不改业务入口。

## A3. 实现 checkpoint 与 pending_action 存储

状态：已完成。

**标题**：实现 checkpoint 和 pending_action 的持久化存储层

**目标**：为恢复执行和人机确认提供最小可用持久化能力。

**主要改动点**：

- 新增 [src/runtime/checkpoint.ts](../../../packages/runtime/src/checkpoint.ts)
- 新增 [src/runtime/pending-actions.ts](../../../packages/runtime/src/pending-actions.ts)
- 提供 `saveCheckpoint()`、`loadCheckpoint()`、`savePendingAction()`、`resolvePendingAction()`
- 约定 timeout、resolvedAt、resolution 等字段

**依赖**：A1、A2

**完成条件**：

1. checkpoint 可覆盖写，pending_action 可单独读写。
2. 同一 run 下支持至少一个未决确认动作和一个最近 checkpoint。

**建议 PR 范围**：只补 store 层，仍不触碰入口。

## B1. 拆分 agent-runner 为 prepare/execute/resume 三段

状态：已完成。`runAgentTurn()` 现已落为兼容入口，内部拆成 `prepareRunContext()`、`executeRunLoop()` 与 `resumeRun()` 三段骨架。

**标题**：重构 agent-runner，分离 prepareRunContext、executeRunLoop、resumeRun

**目标**：把当前 [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts) 的线性流程拆成可恢复的执行骨架。

**主要改动点**：

- 重构 [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts)
- 新增或引入 [src/runtime/executor.ts](../../../packages/runtime/src/executor.ts)
- 把用户上下文装配、history 读取、消息持久化、LLM 调用从单个函数中分层

**依赖**：A2、A3

**完成条件**：

1. `runAgentTurn()` 仍保持兼容签名。
2. 执行器内部已经能接受 `runId` 和 store，而不再只依赖局部变量。

**建议 PR 范围**：只重构执行路径，不改前端协议。

## B2. 为模型路由、消息、chunk、工具和 todo 发运行时事件

状态：已完成。

**标题**：在执行器关键节点补齐 runtime events

**目标**：让事件流成为运行时的真实事实来源。

**主要改动点**：

- 在 [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts) 发 `route_resolved`、`user_message_saved`、`run_completed`、`run_failed`
- 在 LLM chunk 回调处发 `llm_chunk`
- 在工具执行路径补 `tool_call_started`、`tool_call_finished`
- 在 todo 和 artifact 回调处发 `todo_updated`、`artifact_created`

**依赖**：B1

**完成条件**：

1. 单次对话至少能落下：run_created、run_started、route_resolved、user_message_saved、若干 llm_chunk、run_completed。
2. 工具调用和产物不再只存在于 SSE 瞬时流中。

**建议 PR 范围**：事件发射与基础 event payload，不改订阅层。

## B3. 写入执行 checkpoint 并支持 resume

状态：已完成最小可用恢复路径：`resumeRun(runId)` 已可基于持久化 request/checkpoint 恢复文本型 run，并覆盖 `waiting_confirm` 的批准后继续执行。

**标题**：记录执行 checkpoint，并支持从 checkpoint 恢复 run

**目标**：让长任务和被确认中断的任务有恢复点。

**主要改动点**：

- 在 [src/services/agent-runner.ts](../../../packages/agent/src/services/agent-runner.ts) 或 [src/runtime/executor.ts](../../../packages/runtime/src/executor.ts) 中记录 `fullResponse`、history cursor、当前阶段、最近工具步骤
- 实现 `resumeRun(runId)`
- 约定 checkpoint 何时刷新，避免 chunk 级别过度写盘

**依赖**：B2

**完成条件**：

1. 运行到一半时能读取出最近 checkpoint。
2. 对 `waiting_confirm` 或可恢复的 `running` 状态，存在明确的 resume 入口。

**当前范围说明**：当前恢复入口以文本型 run 为主，依赖已落盘的 `request.message` 与 `checkpoint.partialResponse`；多模态请求与更细粒度的 provider 级流恢复仍可后续增强。

**建议 PR 范围**：以服务层恢复为主，不先做启动自动扫描。

## C1. 用 pending_action 替换内存确认注册表

状态：已完成。

**标题**：将危险工具确认从内存 Map 改为持久化 pending_action

**目标**：解决当前 [src/utils/pending-confirm.ts](../../../packages/app/src/utils/pending-confirm.ts) 在进程重启后丢失的问题。

**主要改动点**：

- 调整 [src/utils/pending-confirm.ts](../../../packages/app/src/utils/pending-confirm.ts) 为 runtime-backed 实现，或由 runtime 模块取代
- 在确认触发时写入 `confirm_requested` 事件和 `pending_action`
- 更新 run.status 为 `waiting_confirm`

**依赖**：A3、B2

**完成条件**：

1. 未决确认不再只保存在内存 Map。
2. 即使 SSE 断开，待确认动作仍可重新读取。

**建议 PR 范围**：先保留旧 API 适配层，避免一次性改动前端。

## C2. 改造工具确认 API 与前端 confirm payload

状态：已完成。后端协议与前端消费模型均已支持 `runId/actionId`，同时保留 legacy `confirmId` 兼容层。

**标题**：将 tool-confirm 从 confirmId 改为 runId/actionId 协议

**目标**：让确认接口与运行时状态模型对齐。

**主要改动点**：

- 改造 [src/routes/tool-confirm.ts](../../../packages/app/src/routes/tool-confirm.ts)
- 改造 [packages/web/src/api.ts](../../../packages/web/src/api.ts) 中的 `confirmTool()`
- 改造 [packages/web/src/types/index.ts](../../../packages/web/src/types/index.ts) 的 `tool_confirm` 结构
- 改造 [packages/web/src/components/ChatArea.tsx](../../../packages/web/src/components/ChatArea.tsx) 的 Approve/Deny 流程

**依赖**：C1

**完成条件**：

1. 前端 activity log 能保存 `runId`、`actionId`、确认状态。
2. 服务端可在不依赖内存 `confirmId` 的情况下解析用户决策。

**建议 PR 范围**：后端接口与 Web 端一起改，避免协议中间态长期存在。

## C3. 实现确认超时与未完成 run 收敛器

状态：已完成。

**标题**：实现 waiting_confirm 和半完成 run 的 timeout/recovery 收敛逻辑

**目标**：防止 run 永久悬挂。

**主要改动点**：

- 启动时扫描 `{stateDir}/runs/`
- 对过期 pending_action 生成 `confirm_resolved` 事件并自动拒绝
- 对异常退出遗留的 `running` run 做失败或可恢复收敛

**依赖**：B3、C1

**完成条件**：

1. 超时确认会把 run 推进到确定状态。
2. 服务重启后，不会留下无限期的 `waiting_confirm` 或僵尸 `running` run。

**建议 PR 范围**：以后端启动路径和后台 sweep 为主。

## D1. 增加 runs 查询与控制 API

状态：已完成。

**标题**：新增 runs API：详情、事件流、列表、取消

**目标**：把运行时从内部实现变成可操作对象。

**主要改动点**：

- 新增 [src/routes/runs.ts](../../../packages/app/src/routes/runs.ts)
- 提供 `GET /api/runs/:id`、`GET /api/runs/:id/events`、`GET /api/runs`、`POST /api/runs/:id/cancel`
- 复用 runtime store 和 event reader

**依赖**：A2、A3

**完成条件**：

1. 可以不走聊天 SSE，直接按 runId 查看状态与事件。
2. cancel API 能更新 run 状态并触发执行中止。

**建议 PR 范围**：只做后端 API，不强绑前端页面。

## D2. 将 chat 路由改为“创建 run + 桥接事件到 SSE”

状态：已完成。chat 已创建 run，并将 runtime events 桥接回兼容的 SSE chunk 协议。

**标题**：重构 chat route，使 SSE 订阅 runtime events 而不是直接订阅执行器内存

**目标**：把 [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts) 从“执行入口”降为“运行时桥接层”。

**主要改动点**：

- 改造 [src/routes/chat.ts](../../../packages/app/src/routes/chat.ts)
- 复用 [src/utils/sse.ts](../../../packages/app/src/utils/sse.ts)
- 在创建 run 后，把运行事件转换成现有 `text/tool_call/tool_result/tool_confirm/todo_update/done/error` SSE chunk

**依赖**：B2、D1

**完成条件**：

1. 前端协议在第一步可以保持兼容。
2. SSE 断开不会自动让 run 失败。
3. 路由层不再持有主要执行状态。

**建议 PR 范围**：只覆盖 Web chat，不同时改 notebook chat。

## D3. 统一 cron、Telegram 和 webhook 到 runtime entrypoint

状态：已完成统一 run 元数据与 runtime outcome 消费接线。

**标题**：将 cron / Telegram / webhook 入口统一到 runtime run model

**目标**：让所有异步入口共享相同 run 元数据、状态机和事件流。

**主要改动点**：

- 改造 [src/services/cron-agent.ts](../../../packages/app/src/services/cron-agent.ts)
- 复核 Telegram bot 历史入口（当前已移除）
- 检查 [src/routes/webhook.ts](../../../packages/app/src/routes/webhook.ts)
- 为 run 增加 `entrypoint`、`triggerType`、`parentRunId`、`sessionId` 等元数据

**依赖**：D2

**完成条件**：

1. cron 与 Telegram 触发的任务都能产出 run 记录。
2. 入口层主要负责鉴权和结果消费，不再自己拼执行语义。
3. cron / Telegram / webhook 在 run 结束后可消费 `run_completed` 与 `artifact_created` 结果。

**建议 PR 范围**：先做 cron，再做 Telegram / webhook，避免单 PR 过大。

## E1. 前端接入 run-aware 的确认与事件消费模型

状态：已完成。Web chat 已识别 `runId/actionId/cursor`，并在 SSE 中断后回退到 runs events API 继续追补。

**标题**：让 Web 前端识别 runId/actionId/cursor，并支持事件重连

**目标**：把 Web 端从“单次流式消息消费者”升级为“运行时事件消费者”。

**主要改动点**：

- 改造 [packages/web/src/api.ts](../../../packages/web/src/api.ts) 的 `streamChat()` 和 `confirmTool()`
- 改造 [packages/web/src/lib/stream-transport.ts](../../../packages/web/src/lib/stream-transport.ts) 支持 cursor 或重连语义
- 改造 [packages/web/src/components/ChatArea.tsx](../../../packages/web/src/components/ChatArea.tsx)
- 改造 [packages/web/src/stores/slices/chatSlice.ts](../../../packages/web/src/stores/slices/chatSlice.ts)

**依赖**：C2、D2

**完成条件**：

1. 前端 activity log 记录的确认项可映射到具体 run/action。
2. SSE 断开后，客户端至少具备从最新 cursor 继续追事件的能力。

**建议 PR 范围**：只覆盖主 chat 面板，不扩散到 Notebook 面板。

## E2. 补 runtime 测试矩阵

状态：部分完成。store / events / checkpoint / pending-actions / runs API / sweeper / agent-runner events / resume / confirm-after-restart / cron-runtime / webhook-runtime 已有测试，前端 cursor 级 SSE reconnect 仍待补。

**标题**：补齐 runtime store、resume、confirm、SSE reconnect 测试

**目标**：为运行时重构建立稳定回归网。

**主要改动点**：

- 新增 `src/runtime/__tests__/` 测试目录
- 补 `store`、`events`、`checkpoint`、`pending-action` 单测
- 补 [src/services/__tests__/agent-runner.test.ts](../../../packages/agent/src/services/__tests__/agent-runner.test.ts) 的 runtime 版本用例
- 补 [src/routes/__tests__/chat.test.ts](../../../packages/app/src/routes/__tests__/chat.test.ts) 的 SSE reconnect / confirm 路径

**依赖**：A2、B3、C2、D2

**完成条件**：

1. 可验证 run 创建、事件追加、确认超时、resume、SSE 事件桥接。
2. 至少覆盖一个“服务重启后恢复 waiting_confirm”的场景。

**建议 PR 范围**：优先补最小核心链路，再扩边界分支。

## E3. 补运行时观测与调试能力

**标题**：记录 runtime 指标并提供调试查看入口

**目标**：让运行时具备可调试、可运营的最小能力，而不只是“能跑”。

**主要改动点**：

- 为 run 记录总耗时、工具数、fallback 次数、等待确认耗时
- 接入现有日志体系，如 [src/utils/logger.ts](../../../packages/agent/src/utils/logger.ts)
- 视需要补 run 列表简易调试接口或后台页占位

**依赖**：D1、D2

**完成条件**：

1. 单个 run 的关键指标可以被结构化读取。
2. 出问题时能按 runId 从日志和事件流定位问题。

**建议 PR 范围**：以后端指标为主，UI 面板可后置。

---

## 四、推荐排期

如果按最小可用路径推进，建议拆成这 4 个里程碑：

1. M1：A1 + A2 + A3
2. M2：B1 + B2 + B3
3. M3：C1 + C2 + D1 + D2
4. M4：C3 + D3 + E1 + E2 + E3

这样切的原因是：

- M1 完成后，运行时至少有稳定落盘模型
- M2 完成后，执行过程开始具备事件化和恢复点
- M3 完成后，主 Web chat 已经真正跑在 runtime 上
- M4 再补后台入口、恢复收敛和运维面，整体风险最低

---

## 五、建议优先级

如果你只打算近期真正开工，我会优先拉这 5 个 issue：

1. A1 定义运行时类型与目录布局
2. A2 实现运行时 store 与事件追加 API
3. B1 拆分 agent-runner 为 prepare/execute/resume 三段
4. B2 为模型路由、消息、chunk、工具和 todo 发运行时事件
5. D2 将 chat 路由改为“创建 run + 桥接事件到 SSE”

这 5 个 issue 做完之后，虽然确认持久化和多入口统一还没完成，但主执行链已经从“函数调用”升级为“可追踪运行时”，后面再补 C 和 D 的剩余项会稳很多。
