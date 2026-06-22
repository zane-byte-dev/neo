# Agent Profiles Dev Plan

## Status

Draft. No implementation has started.

## Scope

First slice introduces a declarative `AgentProfile`, a resolver, and enforcement at the `agent-runner` convergence point, with a `default` profile preserving current behavior.

Included:

- `AgentProfile` schema + loader/validator.
- Profile resolution per entrypoint (chat / telegram / cron / workflow / gateway).
- Enforcement: tool allow/deny + tier cap, model/sampling selection, personality injection, memory mode.
- `default` profile = current behavior.

Not included:

- Multi-tenant / shared profiles.
- Visual profile editor UI.
- Replacing `tool-permissions.ts` tiers (layered on top).
- Forcing all entrypoints to bind explicitly.

## Architecture Plan

### Profile Schema + Loader

Suggested files:

- `src/agent/profiles/types.ts` (new)
- `src/agent/profiles/loader.ts` (new)
- `src/agent/profiles/resolve.ts` (new)

Responsibilities:

- Define `AgentProfile` and a strict parse/validate path (consistent with existing config validation style).
- Load profiles from config (`~/.neo/config.json` or a dedicated source — see Open Questions).
- `resolveProfile(entrypoint, userConfig)` returns an effective profile, falling back to `default`.

### Tool Filtering Integration

Suggested files:

- `src/tools/tool-permissions.ts`
- `src/llm/ai-tools.ts`
- `src/services/agent-runner.ts`

Approach:

- Add a profile-aware filter applied alongside `isAllowedInPlanMode`.
- Order: profile `deny` > profile `maxTier` cap > profile `allow` > existing tier/plan-mode rules.
- `buildAiTools()` receives the effective allowed set (or a predicate) from `agent-runner`.

### Model + Sampling

Suggested files:

- `src/llm/model-router.ts`
- `src/services/agent-runner.ts`

Approach:

- Precedence: explicit user `model` override > profile `model` > `resolveSmartRoute()` default.
- Pass profile `sampling` into the LLM call options.

### Personality Injection

Suggested files:

- the system-prompt assembly path in `agent-runner`
- `src/services/user-profile.ts` (coordinate, avoid duplication)

Approach:

- Append profile `personality.instructions` as a bounded system-prompt block.
- Document precedence relative to USER.md content.

### Memory Mode

Suggested files:

- `src/services/agent-runner.ts`
- `src/memory/index.ts`
- memory-writing tools (`save-memory.ts`, `update-now.ts`, `update-user-profile.ts`)

Approach:

- `memory.mode`:
  - `read-write`: unchanged.
  - `read-only`: retrieval allowed, memory-writing tools filtered out / denied.
  - `off`: skip retrieval injection and writing.

### Entrypoint Binding

Suggested files:

- `src/services/agent-runner.ts` (accept `profileId` / entrypoint)
- `src/services/cron-agent.ts`
- `src/services/workflow-service.ts`
- `src/services/ai-gateway-service.ts`
- `src/platforms/telegram-bot.ts`

Approach:

- Each caller passes its entrypoint identity; `agent-runner` resolves the profile.
- Default mapping ships safe defaults (e.g. cron → read-only tools).

## Phases

### Phase 1: Schema + Default Profile

- Add `AgentProfile` types, loader, resolver, `default` profile.
- Unit test parse/validate + default fallback.

### Phase 2: Tool Enforcement

- Layer profile allow/deny/maxTier onto tool building.
- Test that read-only profile excludes write/dangerous tools.

### Phase 3: Model + Personality + Memory

- Wire model/sampling selection.
- Inject personality.
- Enforce memory mode on writing tools.

### Phase 4: Entrypoint Binding

- Bind cron / workflow / gateway / telegram to profiles.
- Verify default-unbound entrypoints match current behavior.

## Testing

Backend:

- Profile schema valid/invalid cases.
- Resolver fallback to `default`.
- Tool filtering precedence (deny > maxTier > allow > tier/plan-mode).
- Model precedence (user > profile > router default).
- Memory mode blocks writing tools when `read-only`/`off`.
- Regression: unbound entrypoint behavior unchanged.

Validation commands:

```bash
npm run build
npx vitest run src/agent src/services src/tools src/llm
npm run docs:check
```
