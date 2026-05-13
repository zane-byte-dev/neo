# Chat Skill Authoring Implementation Plan

## Product Input

Feature brief: [brief.md](brief.md)

Goal: let the Agent turn the current conversation into a reusable Skill without leaving chat, while keeping the existing `workDir` / `stateDir` sandbox boundary intact.

## Current System

- [src/routes/skills.ts](../../../src/routes/skills.ts) already exposes REST CRUD for per-user Skills.
- [web/src/components/SkillsPanel.tsx](../../../web/src/components/SkillsPanel.tsx) already uses those routes in Settings / Skills.
- [src/tools/executor.ts](../../../src/tools/executor.ts) intentionally restricts generic file tools to `workDir`.
- [src/skills/skill-registry.ts](../../../src/skills/skill-registry.ts) loads enabled Skills from `{stateDir}/skills/` into the current user context.

## Design

### Shared Skill Storage Service

Extract reusable file-system operations into a shared module so REST routes and chat tools stop duplicating Skill validation and file discovery.

Service responsibilities:

- Validate Skill names.
- Discover both supported layouts: flat `name.skill.md` and nested `name/skill.md`.
- Read / list all Skills, including disabled ones.
- Create a new Skill from raw Markdown.
- Save or overwrite a Skill from raw Markdown.
- Toggle `enabled` inside frontmatter.
- Delete a Skill by name.

### Chat Tool

Add a new internal tool: `manage_skill`.

Supported actions:

- `list`
- `get`
- `save`
- `delete`
- `set_enabled`

Key behavior:

- `save` accepts full `.skill.md` raw content generated from the current conversation.
- After save/delete/enable-state changes, invalidate the cached user context for future turns.
- Also update the current in-memory `skillRegistry` immediately, so `list_skills` and `run_skill` can use the new state without waiting for reload.

### Registry Sync

Extend `SkillRegistry` with `unregister(name)` so disabling or deleting a Skill removes it from the current run context immediately.

## Files Changed

- [src/skills/skill-store.ts](../../../src/skills/skill-store.ts)
- [src/skills/skill-registry.ts](../../../src/skills/skill-registry.ts)
- [src/tools/internal/manage-skill.ts](../../../src/tools/internal/manage-skill.ts)
- [src/routes/skills.ts](../../../src/routes/skills.ts)
- [src/tools/builtin-guide.ts](../../../src/tools/builtin-guide.ts)
- [src/skills/__tests__/skill-store.test.ts](../../../src/skills/__tests__/skill-store.test.ts)
- [src/tools/internal/__tests__/manage-skill.test.ts](../../../src/tools/internal/__tests__/manage-skill.test.ts)

## Test Plan

Focused automated verification:

- `npx vitest run src/skills/__tests__/skill-store.test.ts src/skills/__tests__/skill-registry-loader.test.ts src/tools/internal/__tests__/manage-skill.test.ts`

Broader verification:

- `npm run build -- --pretty false`
- `npm run docs:check`

## Compatibility Notes

- Existing Settings / Skills behavior is preserved because routes now delegate to the shared storage service.
- Existing manual file-based Skill authoring still works unchanged.
- Disabled Skills remain visible through management surfaces, but `run_skill` / `list_skills` still respect the enabled-only runtime registry.

## Risks

- `manage_skill` stores raw `.skill.md`; malformed content still needs to be surfaced as a validation error.
- There is still no proactive UX that suggests when to save a Skill; this slice only enables the path when the user asks.

## Status

Implemented and validated as MVP on 2026-05-13.