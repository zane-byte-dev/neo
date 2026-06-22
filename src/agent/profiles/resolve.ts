/**
 * src/agent/profiles/resolve.ts — Resolve the effective profile for a turn.
 *
 * Precedence (highest first):
 *   1. Explicit request (`requestedId`).
 *   2. Entrypoint binding (`bindings[entrypoint]`).
 *   3. `default`.
 *
 * Unknown ids fall through to the next precedence level rather than throwing,
 * so a stale binding can never break a turn.
 */

import type { RunEntrypoint } from '../../runtime/types.js';
import { DEFAULT_PROFILE, DEFAULT_PROFILE_ID } from './builtins.js';
import { resolveDefaults } from './loader.js';
import type {
    AgentProfile,
    EntrypointProfileBindings,
    ResolvedProfile,
} from './types.js';

export interface ResolveProfileInput {
    entrypoint: RunEntrypoint;
    /** Explicitly requested profile id (overrides bindings). */
    requestedId?: string;
    /** Available profiles keyed by id. */
    profiles: Map<string, AgentProfile>;
    /** Per-entrypoint default bindings. */
    bindings?: EntrypointProfileBindings;
}

/** Resolve the effective profile, applying precedence and filling defaults. */
export function resolveProfile(input: ResolveProfileInput): ResolvedProfile {
    const { entrypoint, requestedId, profiles, bindings } = input;

    const candidateIds = [
        requestedId,
        bindings?.[entrypoint],
        DEFAULT_PROFILE_ID,
    ];

    for (const id of candidateIds) {
        if (!id) continue;
        const profile = profiles.get(id);
        if (profile) return resolveDefaults(profile);
    }

    // Final safety net — should be unreachable because loadProfiles guarantees
    // a `default`, but never let resolution fail.
    return resolveDefaults(DEFAULT_PROFILE);
}
