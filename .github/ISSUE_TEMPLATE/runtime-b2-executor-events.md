---
name: Runtime B2 - 执行器事件流
about: 在 agent 执行关键节点补齐 runtime events
title: "runtime: 在 agent 执行关键节点补齐 runtime events"
labels: ["area/runtime", "area/agent", "type/backend", "priority/high"]
assignees: []
---

## 背景

运行时要真正可追踪，事件流必须成为事实源，而不是只在 SSE 里瞬时出现文本和工具输出。当前 `agent-runner` 已经有模型路由、消息写入、chunk 回调、todo 和 artifact 回调，这些节点正好是 runtime events 的首批落点。

相关锚点：

- [src/services/agent-runner.ts](../../packages/agent/src/services/agent-runner.ts)
- [src/routes/chat.ts](../../packages/app/src/routes/chat.ts)

## 里程碑

M2 Evented Executor

## 依赖

- B1

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

- 在 [src/services/agent-runner.ts](../../packages/agent/src/services/agent-runner.ts) 发模型路由和消息事件
- 在 LLM chunk 回调处发 `llm_chunk`
- 在工具执行路径补工具开始/结束事件
- 在 todo 和 artifact 回调处发事件
- 为事件 payload 约定最小字段集

### Out of scope

- 不改 SSE 协议桥接层
- 不做 cursor 重连
- 不在这一项里处理确认流持久化

## 完成条件

- [ ] 单次对话至少能落下：`run_created`、`run_started`、`route_resolved`、`user_message_saved`、若干 `llm_chunk`、`run_completed`
- [ ] 工具调用和产物不再只存在于 SSE 瞬时流中
- [ ] 异常路径会记录 `run_failed`，而不是仅抛错结束

## 验证建议

- [ ] 新增执行器事件单测
- [ ] 跑一次带工具调用的对话，确认事件文件中存在工具开始/结束与 todo/artifact 事件