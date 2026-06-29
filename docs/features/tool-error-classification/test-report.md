# Tool Error Classification — Test Report

> Status update (2026-06-23): Phase 1–4 全部落地并通过验证。

## 范围

验证集中式工具错误分类器是否满足 Brief 的 Acceptance Criteria：

- 工具失败时给出结构化分类（`transient` / `quota` / `permanent` / `validation` / `unknown`）+ `retryable` + 建议。
- 失败结果在进入对话上下文前被附加稳定、可解析的提示块。
- 与 `tool-loop-guard` 协同，短路兜底行为不回退。
- 通用启发式 + 可选按工具覆盖（`meta.classifyError`），覆盖优先于启发式。

## 实现

- 新增 [src/llm/tool-error-classifier.ts](../../../packages/agent/src/llm/tool-error-classifier.ts)：`classifyToolError()` / `isFailureResult()` / `formatErrorHint()`。
- 扩展 `ToolMeta`（[src/llm/types.ts](../../../packages/agent/src/llm/types.ts)）新增可选 `classifyError(result, error?)` 覆盖钩子。
- 接入 [src/llm/ai-tools.ts](../../../packages/agent/src/llm/ai-tools.ts) 的 `wrapExecute()`：顺序为 `shortCircuit`（前）→ run → classify+annotate → `record`（后）；记录用原始未标注结果，保证 loop-guard 签名稳定。
- 迁移示例：[src/tools/internal/fetch-url.ts](../../../packages/agent/src/tools/internal/fetch-url.ts) 增加 `meta.classifyError`，把“所有镜像均失败”显式标为 `permanent`。

## 测试结果

- ✅ HTTP 401/403/404 → `permanent` 且 `retryable=false`；429 → `quota`；400/422 → `validation`；5xx/408 → `transient`。
- ✅ 权限 / 参数 / 网络 / 限流关键词（中英文）分别归类为 permanent / validation / transient / quota。
- ✅ 未覆盖文案的新工具失败 → `unknown`（而非无分类）。
- ✅ 成功结果不被附加提示；失败结果末尾出现稳定 `[ToolError] type=... retryable=...` 块。
- ✅ 抛出的 handler 异常被分类并回灌提示。
- ✅ 按工具 `classifyError` 覆盖优先于通用启发式；覆盖返回 null / 抛错时回退启发式。
- ✅ `tool-loop-guard` 既有短路回归测试不变。

- ✅ 工具失败时 `tool_call_finished` 事件 `outcome` 设为 `'error'`，并携带 `errorType` / `retryable` 字段；成功时 `outcome` 保持 `'success'`，无多余字段。

## 验证命令

```bash
npm run build                                    # OK
npx vitest run src/llm src/tools src/services   # 43 files / 427 tests passed
```

新增测试：

- [src/llm/__tests__/tool-error-classifier.test.ts](../../../packages/agent/src/llm/__tests__/tool-error-classifier.test.ts)
- [src/llm/__tests__/ai-tools.test.ts](../../../packages/agent/src/llm/__tests__/ai-tools.test.ts)（新增 hint 注入 / override 集成用例）

## 备注 / Deferred

- `quota` 暂未联动 `src/llm/cost.ts` 限流，仅作模型可读提示。
