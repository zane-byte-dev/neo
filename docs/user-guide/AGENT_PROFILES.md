# Agent Profiles（Agent 画像）

Agent Profile 把「能力边界 + 行为风格」打包成一个声明式对象，让同一个 Neo 实例可以
按入口或任务呈现不同的、被恰当约束的 Agent，而不需要复制配置或改代码。

一个 profile 可以约束：

- **工具**：`allow` 白名单、`deny` 黑名单、`maxTier` 权限层级上限（`read` < `write` < `dangerous`）。
- **模型**：`model` 覆盖（仅当本次请求没有显式指定模型时生效）。
- **人格**：`personality` 文本，作为系统提示的最后一段注入。
- **记忆**：`memory` 策略 —— `off`（不检索、不写入）、`read`（检索但不写入）、`read-write`（默认，与现状一致）。

## 内置 profile

| id | 说明 |
|----|------|
| `default` | 不做任何约束，等价于当前默认行为。未配置时所有入口都用它。 |
| `research` | 只读研究员：`maxTier: read`，`memory: read`，不修改工作区。 |
| `coding` | 编码助手：`maxTier: write`，禁止危险 shell。 |

## 解析优先级

每轮对话解析「生效 profile」的顺序（高优先在前）：

1. 显式请求的 profile id（`AgentRunOptions.profile`）。
2. 入口绑定（`ENTRYPOINT_PROFILES[entrypoint]`）。
3. `default`。

未知的 id 不会报错，而是顺延到下一级，因此过期的绑定永远不会让对话失败。

## 配置

profile 与入口绑定可写在 `src/config.local.ts`（`LocalConfig`）里，或用同名环境变量（JSON 字符串）覆盖。缺省时只有内置 profile 生效，行为与现状一致。

```ts
// src/config.local.ts
export default {
    USERS: [/* … */],
    SESSION_SECRET: '…',

    // 自定义 / 覆盖 profile（按 id 覆盖内置同名 profile）
    PROFILES: [
        {
            id: 'ops',
            name: 'Ops',
            description: '运维助手：可写但禁止危险命令',
            memory: 'read',
            personality: '你是一名严谨的运维助手，操作前先说明影响。',
            tools: { maxTier: 'write', deny: ['bash'] },
        },
    ],

    // 把入口绑定到某个 profile id
    ENTRYPOINT_PROFILES: {
        telegram: 'research',
        cron: 'ops',
    },
};
```

等价的环境变量形式：

```bash
export PROFILES='[{"id":"ops","memory":"read","tools":{"maxTier":"write","deny":["bash"]}}]'
export ENTRYPOINT_PROFILES='{"telegram":"research","cron":"ops"}'
```

## 字段校验

profile 在加载时严格校验，非法字段会抛出明确错误（而不是静默降级）：

- `id` 必填，非空字符串。
- `memory` 必须是 `off` / `read` / `read-write` 之一。
- `tools.maxTier` 必须是 `read` / `write` / `dangerous` 之一。
- `tools.allow` / `tools.deny` 必须是非空字符串数组。

## 与现有机制的关系

- 工具过滤**叠加**在既有权限层级与 plan 模式白名单之上：一个工具必须同时通过两者才会暴露。约束顺序为 `deny > maxTier > allow > 默认允许`。
- `default` profile 不设任何约束、`memory: read-write`，因此未配置时所有入口的行为与升级前完全一致。
