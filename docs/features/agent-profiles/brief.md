# Agent Profiles

> Status: Draft
> Source: Wanda 跨项目借鉴分析（Profile 系统：能力 / 人格 / 模型 / 记忆的声明式隔离）
> Priority: P2

## Background

Neo 目前已有多个 agent 入口：Web Chat、Telegram Bot（`src/platforms/telegram-bot.ts`）、Cron 定时任务（`src/services/cron-agent.ts`）、Workflow（`src/services/workflow-service.ts`）、以及 Local AI Gateway（`src/services/ai-gateway-service.ts`）。它们最终都汇聚到 `src/services/agent-runner.ts` 的同一轮对话逻辑。

但"这个入口能用哪些工具、用哪个模型、带什么人格、能不能写记忆"这些策略，目前**散落在多处**：

- 工具可见性：`src/tools/tool-permissions.ts`（read/write/dangerous 分层）+ plan/notebook 模式过滤。
- 模型选择：`src/llm/model-router.ts`（当前固定回退 `deepseek`）+ 用户 `model` 覆盖。
- 人格 / system prompt：分散在 prompt 组装与 `src/services/user-profile.ts`。
- 偏好：`src/services/user-prefs.ts`。

随着无人值守入口（Cron / Webhook / Workflow）增多，这种分散带来风险：Cron 任务可能误用危险工具（`bash` / `code_exec` / `browser_command`）；不同入口想用不同模型 / 人格时缺少统一开关；AI Gateway 暴露给外部客户端时缺少按场景收敛能力集的机制。

Wanda 用**声明式 Profile**把这些维度收敛到一份配置：工具 allow/deny + 模型 + 采样参数 + 人格 + 记忆模式。引入 Neo 后，可以让"按入口 / 按场景隔离 agent 行为"成为一等公民。

## User Problem

- Cron / Webhook 等无人值守入口缺少独立的能力收敛，存在误用危险工具的风险。
- 不同入口（聊天 vs 自动化 vs Gateway）想用不同模型 / 人格 / 工具集时，要改多处代码。
- AI Gateway 把 Neo 能力暴露给外部客户端时，无法按客户端 / 场景限定工具与模型。
- 现有权限、模型、人格策略分散，难以审查"某个入口到底能做什么"。

## Goals

- 定义声明式 `AgentProfile`：`tools`（allow/deny）+ `model` + `sampling` + `personality` + `memory` 模式。
- 每个 agent 入口可绑定一个 profile（chat / telegram / cron / workflow / gateway 等）。
- profile 在 `agent-runner` 这一汇聚点统一生效：过滤工具、选择模型、注入人格、约束记忆写入。
- profile 用 schema 校验（与现有 config 风格一致），存于用户配置可覆盖。
- 与现有 `tool-permissions` 分层、plan/notebook 模式过滤**叠加**而非替换。
- 提供默认 profile，未绑定入口行为与当前一致（零迁移成本）。

## Non-goals

- 本轮不做多租户 / 跨用户共享 profile。
- 本轮不做可视化 profile 编辑器（先文件 / 配置驱动）。
- 本轮不替换 `tool-permissions.ts` 的三层模型，而是在其之上加 allow/deny。
- 本轮不强制所有入口立即绑定 profile；未绑定即用默认 profile。

## Evidence And Freshness Check

- `src/services/agent-runner.ts`：所有入口汇聚的单轮对话逻辑，是 profile 的统一生效点。
- `src/tools/tool-permissions.ts`：已有 read/write/dangerous 三层与 plan-mode 过滤，可叠加 allow/deny。
- `src/llm/model-router.ts`：`resolveSmartRoute()` 当前固定返回 `deepseek`，profile 可作为模型来源之一。
- `src/services/user-prefs.ts` / `src/services/user-profile.ts` / `src/config.ts`：现有配置载体，可承载 profile 定义。
- `src/services/cron-agent.ts` / `workflow-service.ts` / `ai-gateway-service.ts` / `platforms/telegram-bot.ts`：待绑定 profile 的入口。
- 结论：策略当前分散，无统一 profile 抽象，需求成立。

## Proposed Experience

### 1. AgentProfile 定义

```text
AgentProfile {
  id: string
  tools:   { allow?: string[]; deny?: string[]; maxTier?: 'read'|'write'|'dangerous' }
  model?:  string            // 覆盖 model-router 默认
  sampling?: { temperature?, maxTokens?, topP? }
  personality?: { tone?, style?, instructions? }   // 注入 system prompt
  memory?: { mode: 'read-write' | 'read-only' | 'off' }
}
```

### 2. 入口绑定

每个入口在调用 `agent-runner` 时传入 `profileId`。映射关系存于配置：例如 `cron` → 仅 `read` 工具 + 便宜模型 + `memory: read-only`；`gateway` → 受限工具集 + 无人格闲聊。

### 3. 统一生效点

`agent-runner` 在构建工具集前应用 profile：把 allow/deny + `maxTier` 与现有 `tool-permissions` / plan 模式过滤叠加；按 profile 选模型 / 采样参数；把 `personality` 注入 system prompt；按 `memory.mode` 决定是否允许 `save_memory` / `update_now` / `update_user_profile` 等写记忆工具。

### 4. 默认 profile

提供 `default` profile，等价于当前全量行为。未显式绑定的入口使用它，保证零迁移。

## Acceptance Criteria

- 绑定"只读"profile 的入口（如 cron）无法调用 `bash` / `code_exec` 等写 / 危险工具。
- profile 指定 `model` 时，该入口实际请求使用该模型（可由 `usage.jsonl` 验证）。
- profile 的 `personality.instructions` 出现在该入口的 system prompt 中。
- `memory.mode = 'read-only'` 时，写记忆类工具不可用或被拒绝。
- 未绑定 profile 的入口行为与当前实现一致。
- profile 过滤与现有 plan/notebook 模式过滤叠加生效，互不绕过。

## Open Questions

- profile 定义放在 `~/.neo/config.json`、独立 `profiles.json`，还是 `{workDir}/profiles/`。
- 入口→profile 的映射默认值如何设定，才能既安全（cron 收敛）又不破坏现有体验。
- `tools.allow/deny` 与 `tool-permissions` `maxTier` 冲突时的优先级规则。
- AI Gateway 是否按 API key / 客户端维度选择 profile，还是全局一个 gateway profile。
- personality 注入与现有 `user-profile.ts`（USER.md）如何分工，避免重复或冲突。
