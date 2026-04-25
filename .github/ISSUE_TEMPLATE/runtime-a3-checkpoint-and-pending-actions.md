---
name: Runtime A3 - Checkpoint 与 Pending Action
about: 实现 checkpoint 和 pending_action 的持久化存储层
title: "runtime: 实现 checkpoint 与 pending_action 存储层"
labels: ["area/runtime", "type/backend", "priority/high"]
assignees: []
---

## 背景

运行时仅有 run 和 event 还不够。要支撑恢复执行和危险工具确认，必须把 checkpoint 和 pending_action 做成独立持久化对象，而不是继续停留在内存态。

相关锚点：

- [src/utils/pending-confirm.ts](../../src/utils/pending-confirm.ts)
- [docs/AGENT_RUNTIME_PLAN.md](../../docs/AGENT_RUNTIME_PLAN.md)

## 里程碑

M1 Runtime Foundation

## 依赖

- A1
- A2

## 目标

提供最小可用的 checkpoint 与 pending_action 存储层，为恢复执行与确认流升级做准备。

## 范围

### In scope

- 新增 [src/runtime/checkpoint.ts](../../src/runtime/checkpoint.ts)
- 新增 [src/runtime/pending-actions.ts](../../src/runtime/pending-actions.ts)
- 实现 `saveCheckpoint()`、`loadCheckpoint()`
- 实现 `savePendingAction()`、`resolvePendingAction()`
- 约定 timeout、resolvedAt、resolution 等字段

### Out of scope

- 不在这一项里改造 `tool-confirm` API
- 不实现启动恢复扫描
- 不接线前端 Confirm 流程

## 完成条件

- [ ] checkpoint 可覆盖写，pending_action 可单独读写
- [ ] 同一 run 下支持至少一个未决确认动作和一个最近 checkpoint
- [ ] A3 完成后，后续 C1 可以直接基于 pending_action 改造确认流

## 验证建议

- [ ] 新增 checkpoint/pending-action 单测
- [ ] 覆盖保存、读取、覆盖更新、已解决动作写回场景