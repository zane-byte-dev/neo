---
name: Runtime B1 - 拆分 agent-runner
about: 重构 agent-runner，分离 prepareRunContext、executeRunLoop、resumeRun
title: "runtime: 重构 agent-runner，拆分 prepare/execute/resume 三段"
labels: ["area/runtime", "area/agent", "type/refactor", "priority/high"]
assignees: []
---

## 背景

当前 [src/services/agent-runner.ts](../../src/services/agent-runner.ts) 仍然是单函数串行执行模型：加载用户、准备 session、读取历史、调用 LLM、保存 assistant 消息全部在一个流程中完成。这种结构不利于注入 runtime store、写 checkpoint 和实现 resume。

## 里程碑

M2 Evented Executor

## 依赖

- A2
- A3

## 目标

把 `agent-runner` 重构为可恢复执行骨架，至少拆成：

- `prepareRunContext()`
- `executeRunLoop()`
- `resumeRun()`

同时保留现有 `runAgentTurn()` 兼容入口。

## 范围

### In scope

- 重构 [src/services/agent-runner.ts](../../src/services/agent-runner.ts)
- 新增或引入 [src/runtime/executor.ts](../../src/runtime/executor.ts)
- 将用户上下文装配、history 读取、消息持久化、LLM 调用从单个函数中分层
- 让执行器内部能接受 `runId` 和 runtime store

### Out of scope

- 不在这一项里补齐所有 runtime events
- 不改 chat route 的 SSE 协议
- 不改前端

## 完成条件

- [ ] `runAgentTurn()` 仍保持兼容签名
- [ ] 执行器内部已经能接受 `runId` 和 store，而不再只依赖局部变量
- [ ] 后续 B2/B3 不需要再大拆一次 `agent-runner` 结构

## 验证建议

- [ ] 保持现有 agent-runner 测试通过
- [ ] 补 prepare/execute 层的窄单测或集成测试