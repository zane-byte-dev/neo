# Runtime SDK Boundary

> Status: Draft
> Source: Agent runtime / SDK boundary discussion
> Priority: P0.5

## Background

Neo 已经有一套可恢复、可审计的 agent runtime 雏形：`src/runtime/` 负责 run 生命周期、事件日志、checkpoint、pending action 和 sweeper；`src/services/agent-runner.ts` 负责一轮 agent 执行；`src/routes/chat.ts`、`src/routes/runs.ts`、`src/routes/tool-confirm.ts` 把这些能力暴露给 Web UI。

随着 Neo 后续要支持 CLI、桌面端和更多自动化入口，当前 runtime 逻辑继续耦合在 Koa route 与 Web SSE 形态里，会让新入口只能绕 HTTP 调用，或者复制一套执行逻辑。Runtime SDK 的目标不是立刻发布 npm 包，而是先在 monorepo 内画清目录边界，让 Neo app 成为 runtime 的消费者，而不是 runtime 本身。

## User Problem

- Web、CLI、Desktop、Cron / Workflow 都需要相同的 run、event、approval、resume、cancel 能力。
- 如果 runtime 继续和 Koa / Web SSE 绑定，CLI 和桌面端会被迫依赖本地 HTTP 服务，离线嵌入和原生 IPC 都会变别扭。
- 接入 Claude Agent SDK、OpenAI Agents SDK 或其他 agent executor 时，如果边界不清，它们可能接管工具执行和权限确认，绕过 Neo 自己的 approval queue。
- Notebook、Memory、Profile、Skills 如果直接进入 SDK core，SDK 会膨胀成“Neo 全量代码换个名字”，难以复用。

## Goals

- 把 Neo 的 durable run + event stream 抽成可嵌入 runtime 边界，供 Web、CLI、Desktop 和 automation 共用。
- 保持单人项目的务实节奏：先用目录边界隔离，接口稳定后再拆 npm 包。
- 明确 `AgentExecutor` 与 `ToolExecutor` 的职责边界，确保 runtime 拥有工具权限和 approval queue。
- 让 Notebook、Memory、Profile、Skills 通过 provider / plugin 注入 runtime，而不是成为 runtime core 的硬依赖。
- 建立清晰 import 方向：runtime 层不得 import app 层。

## Non-goals

- 本轮不立即拆出多个 npm packages。
- 本轮不重写现有 runtime store，也不强制从文件存储迁移到 SQLite。
- 本轮不把 Notebook、Memory、Profile、Skills 搬进 runtime core。
- 本轮不直接替换现有 Web API；route 可先作为 runtime 的 adapter 逐步变薄。
- 本轮不重新实现 Claude Agent SDK 或 OpenAI Agents SDK 的通用编排能力。

## Proposed Architecture

### 1. Monorepo 目录边界优先

首阶段先在现有仓库内用目录边界模拟未来包结构：

```text
src/runtime/          # future @neo/runtime
src/runtime/store/    # future @neo/runtime-store
src/executors/        # future @neo/executors
src/app/              # Neo app assembly: routes, adapters, app-specific providers
```

未来包边界可以演进为：

```text
@neo/runtime          # Run, Session, EventBus, ApprovalQueue, executor contracts
@neo/runtime-store    # File / SQLite / memory persistence adapters
@neo/model-client     # ModelClient interface and gateway adapter
@neo/executors        # AI SDK / Claude Agent SDK / OpenAI Agents SDK executor adapters
neo                   # Web / CLI / Desktop app that assembles providers and adapters
```

当前不需要一次性移动所有文件。优先目标是让新代码遵守未来边界，并逐步把 route 中的 runtime orchestration 下沉到 runtime API。

### 2. Import Direction

Runtime core 必须保持向下依赖：

```text
app adapters -> runtime -> runtime-store / executor contracts
```

硬规则：

- `src/runtime/**` 不得 import `src/routes/**`、`web/**` 或未来 `src/app/**`。
- `src/runtime/**` 不得依赖 Koa `ctx`、HTTP response、SSE chunk shape 或 React store shape。
- `src/runtime/**` 可以定义 provider 接口，但不 import Notebook / Memory / Skills 的具体 app 实现。
- `src/routes/**`、CLI、Desktop IPC 只负责把 runtime events 转成各自 presentation protocol。

### 3. Runtime Owns Durable State

Runtime 拥有以下对象和状态转换：

- `runId`
- run status lifecycle
- append-only event log
- checkpoint
- pending action / approval queue
- resume / cancel / expire
- artifact metadata
- session and message persistence contract

Executor 不直接写这些持久化对象。它只产出事件、请求工具、给出 checkpoint payload，由 runtime 统一落盘。

### 4. AgentExecutor vs ToolExecutor

这两个概念必须在类型和命名上分开。

`AgentExecutor` 负责跑 agent loop，例如：

- native AI SDK executor
- Claude Agent SDK executor
- OpenAI Agents SDK executor
- remote executor

它可以：

- 接收 prompt、history、system instruction、model client、available tool descriptors。
- 产出 text / thought / tool request / checkpoint / done / error 等 executor events。
- 在需要工具时请求 runtime 调用工具，并等待工具结果。

它不可以：

- 直接执行 Neo 工具。
- 直接批准危险操作。
- 直接写 run event log、session message、pending action 或 checkpoint 文件。
- 自行拥有不可替换的 session persistence。

`ToolExecutor` 属于 runtime，负责：

- 工具查找和调用。
- 权限层级与 dangerous tool 判断。
- ApprovalQueue / human-in-the-loop。
- cwd / sandbox / tool result cache。
- 将 tool call lifecycle 转成 runtime events。

核心原则：

```text
executor does not own run; runtime owns run.
agent executor requests tool calls; runtime executes tools.
```

### 5. Provider Injection

Notebook、Memory、Profile、Skills 是 Neo app 的特色能力，但不进入 runtime core 的具体实现。Runtime core 只定义接口，例如：

```ts
interface MemoryProvider {
  recall(input: RecallInput): Promise<MemoryHit[]>
  remember?(turn: ConversationTurn): Promise<void>
}

interface KnowledgeProvider {
  search(input: KnowledgeSearchInput): Promise<KnowledgeHit[]>
  resolveCitation?(id: string): Promise<CitationSource | null>
}
```

Neo app 负责提供具体 adapter：

- `NotebookKnowledgeProvider`
- `SemanticMemoryProvider`
- `SkillRegistryProvider`
- `AgentProfileProvider`

这样 runtime 仍然能支持个人知识上下文，但不会被绑定到 Neo Notebook 文件结构或 Web UI。

## Target Runtime API Shape

首版内部 API 可以围绕 durable run 和 async event stream 设计：

```ts
interface AgentRuntime {
  startRun(input: StartRunInput): Promise<RunHandle>
  resumeRun(runId: string): Promise<RunHandle>
  cancelRun(runId: string): Promise<void>
  events(runId: string, opts?: EventCursorOptions): AsyncIterable<RuntimeEvent>
  approveAction(input: ApprovalDecision): Promise<void>
}
```

Web adapter 可以把 `RuntimeEvent` 转成 SSE；CLI adapter 可以转成 terminal rendering；Desktop adapter 可以转成 IPC events。

## Migration Path

1. Define runtime-facing interfaces for `AgentExecutor`, `ToolExecutor`, store, model client and providers.
2. Move route-specific event mapping out of core execution path; routes should become adapters over `RuntimeEvent`.
3. Keep existing `runAgentTurn()` as a compatibility facade while internally delegating to `AgentRuntime.startRun()`.
4. Add a CLI prototype that imports runtime directly instead of calling local HTTP. Status: implemented in `src/cli.ts`.
5. Once Web and CLI both use the same runtime API, consider splitting internal directories into packages.

## Acceptance Criteria

- A Web chat run and a CLI run can be driven by the same runtime API.
- Runtime events are independent of SSE chunk shapes.
- `src/runtime/**` has no imports from routes, frontend, or app-specific adapters.
- An `AgentExecutor` implementation cannot bypass Neo approval for dangerous tools.
- Notebook and Memory features are available through injected providers, not hard-coded runtime imports.
- Existing Web behavior remains compatible while routes become thinner adapters.

## Open Questions

- Should `Session` stay inside `@neo/runtime`, or become an app-provided persistence provider with only a minimal runtime contract?
- Should runtime store remain file-first, or should SQLite become the default once CLI/Desktop sharing appears?
- How much of current `src/services/agent-runner.ts` should move into runtime before the first CLI prototype?
- Should model gateway access live in `@neo/model-client`, or remain an app-level provider until the gateway API stabilizes?
