/**
 * src/agent/profiles/enforcement.ts — Profile-aware tool gating.
 *
 * Decides whether a tool is exposed under a resolved profile. This layers on
 * top of (does not replace) the existing permission tiers and plan-mode
 * allowlist — a tool must pass BOTH checks to be exposed.
 *
 * Ordering (matches plan):
 *   deny  >  maxTier cap  >  allow (allowlist)  >  default allow
 */

import type { Tool, ToolPermission } from '../../llm/types.js';
import { resolveToolPermission } from '../../tools/tool-permissions.js';
import type { ResolvedProfile } from './types.js';

const TIER_RANK: Record<ToolPermission, number> = {
    read: 0,
    write: 1,
    dangerous: 2,
};

/** True iff `tool` may be exposed under `profile`. */
export function isAllowedByProfile(
    name: string,
    tool: Tool | undefined,
    profile: ResolvedProfile,
): boolean {
    const { allow, deny, maxTier } = profile.tools;

    // 1. Explicit deny always wins.
    if (deny.includes(name)) return false;

    // 2. Tier cap.
    if (maxTier !== undefined) {
        const tier = resolveToolPermission(name, tool);
        if (TIER_RANK[tier] > TIER_RANK[maxTier]) return false;
    }

    // 3. Allowlist (only enforced when non-empty).
    if (allow.length > 0 && !allow.includes(name)) return false;

    // 4. Default allow.
    return true;
}
