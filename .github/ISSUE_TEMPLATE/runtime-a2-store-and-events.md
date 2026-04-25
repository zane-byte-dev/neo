---
name: Runtime A2 - Store 与事件追加
about: 实现 runtime store 的 create/load/update/appendEvent 能力
title: "runtime: 实现 runtime store 与事件追加 API"
labels: ["area/runtime", "type/backend", "priority/high"]
assignees: []
---

## 背景

在运行时模型固定之后，下一步需要把 `run` 和 `event` 真正落盘。没有稳定的 store 层，后续的恢复、调试、SSE 重连和确认流持久化都没有锚点。

## 里程碑

M1 Runtime Foundation

## 依赖

- A1

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

- 新增 [src/runtime/store.ts](../../src/runtime/store.ts)
- 新增 [src/runtime/events.ts](../../src/runtime/events.ts)
- 为 `{workDir}/.neo/runs/{runId}/` 提供文件读写能力
- 支持追加式 `events.jsonl`
- 支持按 cursor 增量读取事件

### Out of scope

- 不改 `agent-runner` 业务流程
- 不接入 SSE
- 不处理 checkpoint 或 pending_action 的业务恢复语义

## 完成条件

- [ ] 不调用 LLM 也能创建 run 并写入 `run_created` 事件
- [ ] 同一 run 多次追加事件后，读取顺序稳定且不会覆盖历史事件
- [ ] 进程重启后仍能完整读回 run 和事件流

## 验证建议

- [ ] 新增 runtime store 单测
- [ ] 覆盖空 run 创建、连续 append、reload 后读取三类场景