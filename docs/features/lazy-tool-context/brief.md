# Lazy Tool Context

> Status: Draft
> Source: Wanda 跨项目借鉴分析（`tool_search` 懒加载工具说明）
> Priority: P1

## Background

Neo 当前把**全部工具的说明**一次性注入 system prompt。`src/tools/builtin-guide.ts` 的 `buildBuiltinToolsGuide()` 遍历 `TOOL_DECLARATIONS` 与 `toolRegistry`，为每个工具生成"何时使用"条目；同时 `src/llm/ai-tools.ts` 的 `buildAiTools()` 把每个工具的完整 `description` + `inputSchema` 全量传给 AI SDK。

随着内置工具增多（`research`、`browser_command`、`subagent`、`notebook_search`、`code_exec`…）以及用户工具（`{stateDir}/tools/`）和 MCP 工具（`{workDir}/mcp.json`）的接入，每次请求都携带所有工具的完整 schema。这会带来两个问题：固定的 prompt token 开销随工具数量线性增长；过多工具描述稀释模型注意力，降低工具选择准确率。

Neo 已经有成本追踪能力（`src/llm/cost.ts`、`src/llm/invoke.ts`、`usage.jsonl`），因此这项优化的收益可被直接量化。

## User Problem

- 工具越多，每条消息的固定 prompt token 越高，长会话成本被放大。
- 模型在大量工具描述中更容易选错工具或忽略合适工具。
- MCP / 用户工具接入越多，system prompt 膨胀越快，但单次任务通常只用到少数工具。

## Goals

- system prompt 只默认携带**精简工具目录**（名称 + 一句话用途 + 权限层级），而非每个工具的完整 schema。
- 新增一个 `search_tools` 工具，让模型在需要时按需检索某个工具的**详细说明 / 参数 schema / 使用示例**。
- 详细说明命中后，仅把命中工具的完整上下文注入后续轮次，不污染全局。
- 与现有 plan mode / notebook mode 的工具过滤（`isAllowedInPlanMode`）兼容。
- 提供开关，允许回退到"全量注入"旧行为，避免一次性强制迁移。

## Non-goals

- 本轮不改变工具的实际执行路径（仍走 `executeTool()`）。
- 本轮不做基于 embedding 的语义工具检索；首版用名称 / 关键词 / 分类匹配即可。
- 本轮不强制 MCP 工具懒加载（可作为后续阶段）。
- 本轮不移除 `builtin-guide.ts`，而是让它支持"精简模式"。

## Evidence And Freshness Check

- `src/tools/builtin-guide.ts`：当前为每个工具生成完整"何时使用"段，注入 system prompt。
- `src/llm/ai-tools.ts` `buildAiTools()`：当前把所有工具（内置 + registry + 用户工具）的完整 description/schema 暴露给 AI SDK。
- `src/tools/tool-permissions.ts`：已有 read/write/dangerous 三层，可直接复用为精简目录的元信息。
- `src/llm/cost.ts` / `src/llm/invoke.ts`：已有 usage 记录，可量化 token 收益。
- 结论：当前确为全量注入，懒加载尚未实现，需求成立。

## Proposed Experience

### 1. 精简工具目录（默认注入）

system prompt 中工具区只保留一张紧凑表：`工具名 | 一句话用途 | 权限层级`。不含完整参数 schema 与长示例。

### 2. `search_tools` 工具（按需展开）

模型可调用 `search_tools(query | name | category)` 获取一个或多个工具的：完整 description、参数 schema、使用示例、注意事项。命中结果作为 tool result 返回，进入对话上下文供后续轮次使用。

### 3. 命中即可直接调用

模型展开某工具说明后，可在同一循环内直接调用该工具——`buildAiTools()` 仍然注册了所有工具的可执行入口，懒加载只影响**说明文本的注入量**，不影响可调用性。

### 4. 兼容现有模式

plan mode / notebook mode 下，精简目录与 `search_tools` 命中结果都要继续遵守 `isAllowedInPlanMode` 过滤，只读模式不展示写 / 危险工具。

### 5. 可回退开关

用户配置（`~/.neo/config.json` 或 user-prefs）提供 `toolContext: 'lazy' | 'full'`，默认 `lazy`，可切回 `full` 复现旧行为。

## Acceptance Criteria

- 默认模式下，system prompt 工具区只包含精简目录，不含完整参数 schema。
- 模型可通过 `search_tools` 获取指定工具的完整说明并随后成功调用该工具。
- 同一会话注入的工具说明 token 数显著低于全量模式（用 `usage.jsonl` 对比验证）。
- plan mode 下 `search_tools` 不返回写 / 危险工具的说明。
- 配置切回 `full` 时行为与当前实现一致。

## Open Questions

- 精简目录是否需要按权限层级或用途分组展示，帮助模型快速定位。
- `search_tools` 的匹配策略首版用前缀 / 关键词 / 分类，还是直接复用 `notebook_search` 之外的简单检索。
- 用户工具与 MCP 工具是否在首版就纳入懒加载，还是先只覆盖内置 + registry 工具。
- 默认是否对工具数量低于某阈值（如 < 12）的用户保持全量注入以免增加一次往返。
