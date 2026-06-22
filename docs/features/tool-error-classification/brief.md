# Tool Error Classification

> Status: Draft
> Source: Wanda 跨项目借鉴分析（`classifyError()` 错误分类回灌 LLM）
> Priority: P1

## Background

Neo 当前处理工具失败的机制是 `src/llm/tool-loop-guard.ts`。它在一次 `chatWithContextStreaming` 范围内，按 `toolName` 维护"连续失败签名队列"，当某工具连续 N 次返回同类失败结果后**短路**，返回一段强提示要求模型换策略。

这个机制有效但有两个局限：

1. **失败签名是按工具硬编码的**——`failureSignature()` 目前只覆盖 `search_web`（`暂无搜索结果` / `引擎不可用`）和 `fetch_url`（`HTTP <code>` / `网络错误`）。新增工具或工具改了错误文案，就不在保护范围内。
2. **错误没有结构化语义**——模型只看到一段自由文本错误，无法区分"这是临时网络抖动（值得重试）"还是"权限不足 / 参数非法（重试无意义）"。模型可能对永久性错误反复重试，浪费 token；也可能对临时错误过早放弃。

Wanda 的做法是给每个工具错误打结构化标签（`transient` / `quota` / `permanent` / `validation`）并连同建议动作一起回灌给模型，由模型决定是否重试，框架本身不做自动 backoff。把这套思路引入 Neo，可以让错误处理从"按工具硬编码短路"升级为"通用、结构化、模型可决策"。

## User Problem

- 工具失败时模型缺乏判断依据，对永久性错误（如鉴权失败、参数非法）反复重试，浪费 token 和时间。
- 新工具的失败模式不在 `tool-loop-guard` 硬编码覆盖内，得不到保护。
- 用户看到的失败行为不一致：有的工具会被短路提示，有的会无限重试。

## Goals

- 定义统一的工具错误分类：`transient` / `quota` / `permanent` / `validation` / `unknown`。
- 在工具结果进入对话上下文前，对失败结果做一次分类，并附带结构化提示（错误类型 + 建议动作）。
- 让分类结果以模型可读的结构化形式回灌，由模型决定是否重试——框架不自动 backoff。
- 与现有 `tool-loop-guard` 协同：分类用于"是否值得重试"的语义判断，loop-guard 继续负责"同一失败重复过多次"的兜底短路。
- 分类逻辑通用化，不再依赖逐工具硬编码字符串（保留按工具覆盖的可选项）。

## Non-goals

- 本轮不引入自动重试 / 指数退避；重试与否仍由模型决定。
- 本轮不改 `executeTool()` 的成功路径。
- 本轮不替换 `tool-loop-guard`，而是与之协作。
- 本轮不要求所有工具改写错误返回格式；先做集中式分类器 + 渐进式按工具标注。

## Evidence And Freshness Check

- `src/llm/tool-loop-guard.ts`：`failureSignature()` 仅硬编码 `search_web` / `fetch_url`，`MAX_CONSECUTIVE_FAILURES = 3`。
- `src/llm/ai-tools.ts` `buildAiTools()`：`wrapExecute()` 已在 `execute()` 前后包了 `guard.shortCircuit` / `guard.record`，是注入分类的天然挂载点。
- `src/tools/executor.ts` / `src/tools/internal/*`：工具返回字符串结果，错误多以 `[Error] ...` 前缀表达。
- 结论：当前无结构化错误分类，错误处理依赖逐工具硬编码字符串匹配，需求成立。

## Proposed Experience

### 1. 统一错误分类器

新增集中式分类器，输入 `toolName + result`（及可选的抛出异常），输出 `{ type, retryable, suggestion }`。默认基于通用启发式（HTTP 状态码、`权限/forbidden/unauthorized`、`invalid/参数`、`timeout/网络` 等关键词）。

### 2. 结构化回灌

当工具结果被判定为失败时，在返回给模型的 tool result 末尾附加一段结构化提示，例如：错误类型、是否值得重试、建议的下一步（换工具 / 换参数 / 停止）。

### 3. 与 loop-guard 协作

- 分类器回答"这次失败是什么性质、要不要重试"。
- loop-guard 继续回答"同一失败是否已重复太多次，需要强制短路"。
- 二者叠加：永久性错误第一次就提示模型不要重试；临时性错误允许有限重试，超过阈值再由 loop-guard 短路。

### 4. 可选的按工具覆盖

工具可通过 `meta` 声明自定义分类规则（类似现有 `meta.permission`），覆盖通用启发式，迁移现有 `search_web` / `fetch_url` 的专用签名到此机制。

## Acceptance Criteria

- 工具返回鉴权 / 参数类错误时，回灌提示标记为 `permanent` / `validation` 且 `retryable=false`。
- 工具返回网络 / 超时类错误时，标记为 `transient` 且 `retryable=true`。
- 未覆盖文案的新工具失败时，至少得到 `unknown` 分类而不是无分类。
- 现有 `search_web` / `fetch_url` 的短路行为不回退（loop-guard 仍生效）。
- 分类提示以结构化、稳定的格式出现在 tool result 中，便于模型解析。

## Open Questions

- 分类提示用 JSON 片段、固定前缀文本，还是两者皆可（取决于各 provider 对结构化 tool result 的解析稳定性）。
- 是否需要把分类结果同时写入 run 事件日志（`src/runtime/`），用于后续可观测性。
- `quota` 类错误是否需要联动成本 / 限流逻辑（`src/llm/cost.ts`），还是仅作提示。
- 通用启发式与按工具覆盖的优先级与冲突处理策略。
