# Agent Profiles — Test Report

> First slice. Validates schema/loader, resolver precedence, tool enforcement
> ordering, and that the `default` profile preserves current behaviour.

## Scope verified

- Declarative `AgentProfile` schema + strict loader/validator.
- Resolver precedence: explicit request > entrypoint binding > `default`.
- Default-fill (`resolveDefaults`): `memory` defaults to `read-write`, tool
  policy defaults to unconstrained.
- Tool enforcement ordering: `deny > maxTier cap > allow (allowlist) > default
  allow`, layered on top of existing tier / plan-mode rules in `buildAiTools`.
- Config wiring: `LocalConfig.PROFILES` / `ENTRYPOINT_PROFILES` (+ env vars),
  built-in profiles always present, config overrides built-ins by id.
- Runner integration: model override (only when caller didn't pick a model),
  personality injection into the system prompt, memory-mode gating of recall
  (`src/llm/client.ts`) and persistence (`rememberTurn` in `agent-runner`).

## Automated tests

New: `src/agent/profiles/__tests__/profiles.test.ts` — 21 cases.

```
npm run build            # tsc — passes
npx vitest run src/agent/profiles
#  Test Files  1 passed (1)
#       Tests  21 passed (21)
```

Coverage highlights:

- `parseAgentProfile`: valid minimal, field trimming, and rejection of missing
  `id` / invalid `memory` / invalid `maxTier` / non-string `allow` entries.
- `resolveDefaults`: memory default fill + explicit-value preservation.
- `loadProfiles`: built-in `default`/`research` present, config overrides by id,
  throws on malformed config profile.
- `resolveProfile`: explicit > binding > default; unknown request falls through
  to binding; unknown binding falls through to default.
- `isAllowedByProfile`: unconstrained allows everything; deny beats allow;
  `maxTier` caps by tier; non-empty allowlist hides unlisted tools.

## Regression

Full suite: `npx vitest run` → **803 tests passed**.

Four route suites (`assets`, `auth-routes`, `model`, `notebook-source-studio`)
fail at collection time with a pre-existing vitest mock-hoisting error
(`Cannot access 'calcUserMock' before initialization` in `test-helpers.ts`).
Confirmed pre-existing: the same suites fail identically with this change
stashed, so it is unrelated to Agent Profiles.

## Behaviour preservation

The built-in `default` profile sets no tool constraints, no model override, no
personality, and `memory: 'read-write'`. With no `PROFILES` / `ENTRYPOINT_PROFILES`
configured, every entrypoint resolves to `default`, so tool exposure, model
routing, memory recall, and memory persistence are byte-for-byte unchanged.

## Files

New:

- `src/agent/profiles/types.ts`
- `src/agent/profiles/builtins.ts`
- `src/agent/profiles/loader.ts`
- `src/agent/profiles/resolve.ts`
- `src/agent/profiles/enforcement.ts`
- `src/agent/profiles/index.ts`
- `src/agent/profiles/__tests__/profiles.test.ts`
- `docs/user-guide/AGENT_PROFILES.md`

Changed:

- `src/config.ts` — `LocalConfig.PROFILES` / `ENTRYPOINT_PROFILES` + accessors.
- `src/llm/types.ts` — `ToolContext.profile`.
- `src/llm/ai-tools.ts` — profile-aware tool filtering.
- `src/llm/client.ts` — memory-recall gating by profile memory mode.
- `src/services/agent-runner.ts` — profile resolution, model/personality/memory
  enforcement, `AgentRunOptions.profile`.
