/**
 * tool-permissions.ts — Centralised permission tiering for all tools.
 *
 * Three tiers: 'read' | 'write' | 'dangerous'.
 *
 * Usage:
 *   - `resolveToolPermission(name, tool)` returns the effective tier.
 *   - Plan mode allows only 'read' tools.
 *   - Dangerous tools may trigger a confirmation hook (see ToolContext.confirmCallback).
 *
 * Built-in tools (declared in executor.ts) are mapped here; registry tools
 * declare their own tier via `meta.permission`.
 */

import type { Tool, ToolPermission } from '../llm/types.js';

/** Explicit permission map for built-in tools in src/tools/executor.ts */
const BUILTIN_PERMISSIONS: Record<string, ToolPermission> = {
    read_file: 'read',
    list_dir: 'read',
    write_file: 'write',
    bash: 'dangerous',
};

/**
 * Best-effort fallback when an internal/registry tool has no explicit
 * `meta.permission`. Errs on the side of caution.
 */
const NAME_HEURISTICS: Array<[RegExp, ToolPermission]> = [
    [/^(read|get|list|search|grep|glob|fetch|view|find|describe)/i, 'read'],
    [/^(write|edit|save|update|delete|remove|create|patch|append)/i, 'write'],
    [/^(bash|exec|run|shell|spawn|install)/i, 'dangerous'],
];

export function resolveToolPermission(name: string, tool?: Tool): ToolPermission {
    if (tool?.meta?.permission) return tool.meta.permission;
    const builtin = BUILTIN_PERMISSIONS[name];
    if (builtin) return builtin;
    for (const [pattern, tier] of NAME_HEURISTICS) {
        if (pattern.test(name)) return tier;
    }
    // Safe default: treat unknown tools as write-tier so plan mode excludes them.
    return 'write';
}

/** True iff the tool is allowed to run in plan mode. */
export function isAllowedInPlanMode(name: string, tool?: Tool): boolean {
    // exit_plan_mode is always allowed so the agent can leave plan mode.
    if (name === 'exit_plan_mode') return true;
    return resolveToolPermission(name, tool) === 'read';
}
