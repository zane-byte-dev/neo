# Runtime SDK Extraction Plan

> Status: Draft
> Last updated: 2026-06-23

## Current State

Runtime SDK extraction has started as an internal boundary, not as npm packages.

Implemented:

- `src/runtime/index.ts` is the public runtime surface.
- `src/runtime/contracts.ts` defines `AgentRuntime`, `ToolExecutor`, run input/output contracts and artifact result types.
- `src/app/agent-runtime.ts` implements the app-level `NeoAgentRuntime` adapter.
- `src/app/run-event-sse.ts` maps runtime events to the Web SSE stream shape.
- `src/app/tool-executor.ts` wires the runtime `ToolExecutor` contract to Neo's concrete tool system.
- `src/executors/types.ts` defines `AgentExecutor`.
- `src/executors/ai-sdk-executor.ts` wraps the current `LLMClient` path as the default executor.
- `src/cli.ts` and `src/cli/core.ts` provide a direct runtime CLI consumer, without going through HTTP.
- Runtime boundary tests prevent `src/runtime/**` from importing app/service/route/tool/LLM layers and prevent production deep imports of runtime internals.

## Phase 1: Stabilize Public Runtime Surface

Goal: make `src/runtime/index.ts` the only production import target for runtime APIs.

Tasks:

- Keep production imports pointed at `../runtime/index.js` or `./runtime/index.js`.
- Keep runtime module unit tests free to deep-import internals.
- Add any new runtime APIs to `src/runtime/index.ts` intentionally.
- Avoid exporting app adapters, concrete tools, concrete LLM clients or Koa/Web types from runtime.

Acceptance:

- `npm run build` passes.
- Runtime boundary test passes.
- Web chat and CLI both run through `AgentRuntime`.

Status: implemented.

## Phase 2: Make Runtime Store Adapter Shape Explicit

Goal: prepare for `@neo/runtime-store` without moving files yet.

Tasks:

- Introduce a `RuntimeStore` interface covering run CRUD, events, checkpoints, pending actions and tool approvals.
- Wrap existing file-backed functions as `FileRuntimeStore`.
- Keep current function exports for compatibility while routing new code through the store interface.
- Decide whether sessions remain runtime-owned or app-provided.

Acceptance:

- `NeoAgentRuntime` can be constructed with a store-like dependency.
- Existing routes and CLI behavior stay unchanged.

Status: implemented at the adapter-shape level. `RuntimeStore` and `FileRuntimeStore` now cover run CRUD, events, checkpoints, pending actions and tool approvals. Existing direct function exports remain for compatibility; migrating older call sites through the store can happen incrementally.

## Phase 3: Move Agent Runner Behind Runtime

Goal: make `services/agent-runner.ts` stop being the conceptual runtime owner.

Tasks:

- Move run orchestration types and lifecycle code behind `NeoAgentRuntime`.
- Keep `runAgentTurn()` and `resumeRun()` as compatibility facades.
- Ensure `AgentExecutor` never writes persistent run state directly.
- Keep `ToolExecutor` and approval queue runtime-owned.

Acceptance:

- Web and CLI call `AgentRuntime`.
- Existing workflow/cron/webhook entrypoints either call `AgentRuntime` or are explicitly tracked as remaining adapters.

Status: implemented as an internal compatibility boundary. Web, CLI, cron, workflow agent steps, webhook and disk-backed tool-confirm resume now call `AgentRuntime`; production code may only import `services/agent-runner` from `src/app/agent-runtime.ts`. The runner remains as the implementation facade behind `NeoAgentRuntime` until the package split moves lifecycle code into the runtime package.

## Phase 4: Create First Package Boundary

Goal: mechanically split the stable runtime surface.

Target:

```text
packages/runtime/
  src/index.ts
  src/contracts.ts
  src/types.ts
  src/store.ts
  src/events.ts
  src/checkpoint.ts
  src/pending-actions.ts
  src/tool-approvals.ts
```

Tasks:

- Move runtime files with minimal path changes.
- Configure TypeScript project references or workspace paths.
- Keep `src/runtime/index.ts` as a temporary re-export shim if needed.
- Move runtime tests alongside the package or keep integration tests in app.

Acceptance:

- App imports `@neo/runtime` or workspace alias.
- Build and full tests pass.

Status: implemented for app consumption. `packages/runtime` exists as the private workspace package `@neo/runtime`, builds independently, and contains a self-contained runtime source copy with package-local utilities. Production app code now imports runtime APIs from `@neo/runtime`; `src/runtime/index.ts` remains only as a temporary compatibility shim for any older imports. Focused runtime unit tests still live under `src/runtime/__tests__` until they are moved with the package.

## Phase 5: Split Optional Adapters

Goal: keep runtime core small and move concrete implementations into opt-in packages or app folders.

Candidates:

- `@neo/runtime-store-file`
- `@neo/executor-ai-sdk`
- `@neo/model-client`
- app-local Notebook / Memory / Skill providers

Non-goal:

- Do not move Notebook, Memory, Skills or Web UI into runtime core.

## Open Decisions

- Should `Session` be a runtime primitive or an app-provided provider?
- Should `RuntimeEvent` stay identical to on-disk `RunEvent`, or should runtime expose a higher-level event union for adapters?
- Should CLI get interactive approval prompts, or keep `--yes` / `--no` for the first milestone?
- Should cron/workflow/webhook migrate to `AgentRuntime` before or after package split?
