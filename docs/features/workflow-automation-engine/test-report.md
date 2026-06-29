# Workflow Automation Engine — Test Report

> Status update (2026-05-19): Automations 页的 Workflow JSON 编辑器已补保存前本地校验。当前会在保存前校验 workflow ID、`trigger` / `steps` 结构与必填字段，并为 JSON 语法错误和结构错误提供行列定位。

## Scope

验证 Phase 1 MVP：声明式 Workflow 定义、串行步骤执行、手动 / Webhook / Cron 触发入口、Cron 运行历史、Automations 页基础管理入口，以及本轮顺手修复的 Notebook / Note UX 快赢。

## Acceptance Coverage

- ✅ 用户可以创建包含至少 2 个步骤的 Workflow。
- ✅ Workflow 支持手动触发，并支持 Webhook 与 Cron 触发配置。
- ✅ 后续步骤可以通过 `{{previous}}` 和 `{{steps.stepId}}` 读取前序输出。
- ✅ Workflow run 会记录成功 / 失败状态、步骤状态、耗时、输出与错误。
- ✅ Settings / Advanced / Automations 可以保存 JSON Workflow、手动运行并查看最近运行状态。
- ✅ 现有 Cron / Webhook 路径保留；Cron 列表不再只返回空的 `last_*` 字段。
- ✅ 新建笔记本输入框 blur 时不再静默丢弃已输入名称。
- ✅ 手动保存笔记会给出成功 / 失败 toast。
- ✅ Notebook 空状态提供新建文章按钮，无日期条目的列表布局不再留下空元信息行。

## Automated Coverage

- [../../../src/services/__tests__/workflow-service.test.ts](../../../packages/app/src/services/__tests__/workflow-service.test.ts)：覆盖 transform 串行执行与 `previous` 输出传递。
- [../../../src/routes/__tests__/workflows.test.ts](../../../packages/app/src/routes/__tests__/workflows.test.ts)：覆盖 Workflow 创建、列表与手动运行。
- [../../../src/routes/__tests__/cron.test.ts](../../../packages/app/src/routes/__tests__/cron.test.ts)：覆盖 Cron 最近运行字段。
- [../../../src/services/__tests__/cron-agent-runtime.test.ts](../../../packages/app/src/services/__tests__/cron-agent-runtime.test.ts)：回归 Cron Agent artifact 交付路径。

## Validation Commands

- ✅ `npx vitest run src/services/__tests__/workflow-service.test.ts src/routes/__tests__/workflows.test.ts src/routes/__tests__/cron.test.ts src/services/__tests__/cron-agent-runtime.test.ts`
- ✅ `npm run build -- --pretty false`
- ✅ `npm --prefix web run build`
- ✅ `npm --prefix web run build`（2026-05-19：复验 Workflow 编辑器本地校验与 i18n 改动）

## Residual Risk

- JSON 编辑器已具备保存前结构校验与错误定位，但普通用户仍需要手写 JSON；后续仍需要 schema-aware 表单或模板向导继续降低门槛。
- Skill step 已接入现有 Skill executor，但未在本轮自动化测试中调用真实 LLM 型 Skill，避免测试依赖外部模型。
- Cron Workflow 的完整端到端调度依赖进程中的 node-cron，本轮覆盖了服务、路由和调度代码构建，未做长时间等待型 E2E。