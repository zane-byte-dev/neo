/**
 * src/agent/profiles/index.ts — Public barrel + config-backed resolution.
 */

import { getEntrypointProfiles, getProfilesConfig } from '../../config.js';
import type { RunEntrypoint } from '../../runtime/types.js';
import { loadProfiles } from './loader.js';
import { resolveProfile } from './resolve.js';
import type { ResolvedProfile } from './types.js';

export * from './types.js';
export { isAllowedByProfile } from './enforcement.js';
export { loadProfiles, parseAgentProfile, resolveDefaults } from './loader.js';
export { resolveProfile } from './resolve.js';
export { BUILTIN_PROFILES, DEFAULT_PROFILE, DEFAULT_PROFILE_ID } from './builtins.js';

/**
 * Resolve the effective profile for a turn using the current config.
 * Combines built-in profiles + config profiles + entrypoint bindings.
 */
export function resolveAgentProfile(
    entrypoint: RunEntrypoint,
    requestedId?: string,
): ResolvedProfile {
    const profiles = loadProfiles(getProfilesConfig());
    const bindings = getEntrypointProfiles();
    return resolveProfile({
        entrypoint,
        ...(requestedId !== undefined && { requestedId }),
        profiles,
        bindings,
    });
}
