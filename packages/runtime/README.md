# @neo/runtime

Private workspace package for Neo's durable agent runtime.

This package owns runtime-level contracts and persistence primitives:

- run records and event logs
- checkpoints and pending actions
- tool approval rules
- runtime store adapters
- runtime-facing `AgentRuntime` / `ToolExecutor` contracts

It must stay independent from the Neo app layer. Do not import Koa routes,
services, app adapters, concrete tools, LLM clients, skills, memory, notebooks,
or web UI modules from this package.

Current migration state:

- `@neo/runtime` builds independently.
- Production app code imports runtime APIs from `@neo/runtime`.
- `src/runtime/index.ts` remains as a temporary compatibility shim.
- Focused runtime unit tests still live under `src/runtime/__tests__` until they
  move with this package.
