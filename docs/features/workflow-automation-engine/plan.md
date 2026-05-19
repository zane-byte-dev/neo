# Workflow Automation Engine — Dev Plan

> Status update (2026-05-19): Workflow MVP 继续收口。Automations 页的 JSON 编辑器已补保存前本地校验，覆盖 workflow ID、`trigger` / `steps` 结构与 JSON 语法错误定位；完整模板库 / 向导式创建仍保持 defer。

## Scope

Phase 1 MVP 聚焦把现有 Cron / Webhook / Agent Runtime / Skill 底座升级为可追踪的轻量工作流层，不做可视化拖拽、复杂分支、循环或外部连接器。

## Freshness Check

- [brief.md](brief.md) 已确认现有自动化只有单步 Cron / Webhook。
- [../../../src/services/cron-agent.ts](../../../src/services/cron-agent.ts) 已能按计划触发 Agent turn。
- [../../../src/routes/webhook.ts](../../../src/routes/webhook.ts) 已能用用户 `webhookSecret` 触发 Agent。
- [../../../src/skills/skill-store.ts](../../../src/skills/skill-store.ts) 与 [../../../src/skills/skill-executor.ts](../../../src/skills/skill-executor.ts) 已提供 Skill 存储和执行能力。

## Implementation Plan

1. 新增 Workflow 服务层，持久化定义和运行历史到 `{stateDir}/workflows/`。
2. 支持 `manual` / `webhook` / `cron` 三类 trigger。
3. 支持 `transform` / `agent` / `skill` 三类串行 step，并允许用 `{{previous}}`、`{{steps.stepId}}`、`{{input.*}}` 引用上下文。
4. 新增 Workflow REST API 与 secret-authenticated webhook endpoint。
5. 将 cron-agent 扩展为同时调度传统 Cron 任务和 Cron Workflow。
6. 为传统 Cron 任务补真实运行历史，替换原先的 `last_* = null` 占位。
7. 在 Settings / Advanced / Automations 中加入 JSON Workflow 管理入口、手动运行和最近状态展示。
8. 同步用户指南、路线图、README 与 CHANGELOG。

## Delivered MVP

- 后端服务：[../../../src/services/workflow-service.ts](../../../src/services/workflow-service.ts)
- HTTP 路由：[../../../src/routes/workflows.ts](../../../src/routes/workflows.ts)
- Cron 历史：[../../../src/services/cron-history.ts](../../../src/services/cron-history.ts)
- Automations UI：[../../../web/src/components/SettingsPanel.tsx](../../../web/src/components/SettingsPanel.tsx)
- JSON 编辑器保存前校验：[../../../web/src/lib/workflow-validation.ts](../../../web/src/lib/workflow-validation.ts)

## Deferred

- 条件分支、循环、并行、重试策略。
- 工作流运行详情页和步骤日志展开 UI。
- 文件变更、RSS、邮件、日历等事件触发器。
- YAML 编辑器与 schema-aware 表单 / 模板向导。