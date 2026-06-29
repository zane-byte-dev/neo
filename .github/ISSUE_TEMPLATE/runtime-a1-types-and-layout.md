---
name: Runtime A1 - 类型与目录布局
about: 定义运行时类型、状态机和目录约定
title: "runtime: 定义运行时类型、状态机和目录约定"
labels: ["area/runtime", "type/architecture", "priority/high"]
assignees: []
---

## 背景

当前 Agent 执行仍然是“请求内执行”的模型，状态主要存在于调用栈和内存回调里。要把运行时演进为可恢复、可审计、可跨入口复用的模型，第一步必须先固定运行时对象、状态机和目录布局，避免后续实现阶段反复改文件格式。

相关锚点：

- [src/services/agent-runner.ts](../../packages/agent/src/services/agent-runner.ts)
- [src/routes/chat.ts](../../packages/app/src/routes/chat.ts)
- [src/services/cron-agent.ts](../../packages/app/src/services/cron-agent.ts)
- [docs/features/agent-runtime/plan.md](../../docs/features/agent-runtime/plan.md)

## 里程碑

M1 Runtime Foundation

## 依赖

无

## 目标

定义可恢复运行时的稳定数据模型，包括：

- `RunRecord`
- `RunStatus`
- `RunEvent`
- `PendingAction`
- `RunArtifact`

同时固定 `{stateDir}/runs/{runId}/` 下的目录与文件约定。

## 范围

### In scope

- 新增 [src/runtime/types.ts](../../packages/runtime/src/types.ts)
- 定义状态枚举：`queued`、`running`、`waiting_confirm`、`waiting_input`、`completed`、`failed`、`cancelled`、`expired`
- 定义运行目录布局：`run.json`、`events.jsonl`、`checkpoint.json`、`pending.json`、`artifacts/`
- 给出至少 1 份 JSON 示例，说明运行时对象的最小字段集合

### Out of scope

- 不实现运行时存储读写
- 不修改 `agent-runner` 执行逻辑
- 不改 chat route、tool-confirm API 或前端协议

## 完成条件

- [ ] 类型定义能够覆盖 [src/services/agent-runner.ts](../../packages/agent/src/services/agent-runner.ts)、[src/routes/chat.ts](../../packages/app/src/routes/chat.ts)、[src/services/cron-agent.ts](../../packages/app/src/services/cron-agent.ts) 的最小运行时需求
- [ ] 文档中有明确 JSON 示例，后续 issue 不需要再次发明字段
- [ ] 状态机与目录布局已在文档和代码中对齐

## 验证建议

- [ ] 类型检查通过
- [ ] 文档评审通过
- [ ] A2/A3 可以直接复用这些类型