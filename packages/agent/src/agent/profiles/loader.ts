/**
 * src/agent/profiles/loader.ts — Parse / validate agent profiles.
 *
 * Profiles may come from built-ins (always present) or user config. Config
 * profiles override built-ins with the same id. Parsing is strict: malformed
 * profiles throw with a clear message rather than silently degrading.
 */

import type { ToolPermission } from '../../llm/types.js';
import { BUILTIN_PROFILES, DEFAULT_PROFILE, DEFAULT_PROFILE_ID } from './builtins.js';
import type {
    AgentProfile,
    ProfileMemoryMode,
    ProfileToolPolicy,
    ResolvedProfile,
} from './types.js';

const MEMORY_MODES: readonly ProfileMemoryMode[] = ['off', 'read', 'read-write'];
const TOOL_TIERS: readonly ToolPermission[] = ['read', 'write', 'dangerous'];

function asStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) throw new Error(`AgentProfile: \`${field}\` must be an array of strings`);
    return value.map((v, i) => {
        if (typeof v !== 'string' || !v.trim()) {
            throw new Error(`AgentProfile: \`${field}[${i}]\` must be a non-empty string`);
        }
        return v.trim();
    });
}

function parseToolPolicy(raw: unknown): ProfileToolPolicy | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'object') throw new Error('AgentProfile: `tools` must be an object');
    const obj = raw as Record<string, unknown>;
    const policy: ProfileToolPolicy = {};
    if (obj.allow !== undefined) policy.allow = asStringArray(obj.allow, 'tools.allow');
    if (obj.deny !== undefined) policy.deny = asStringArray(obj.deny, 'tools.deny');
    if (obj.maxTier !== undefined) {
        if (!TOOL_TIERS.includes(obj.maxTier as ToolPermission)) {
            throw new Error(`AgentProfile: \`tools.maxTier\` must be one of ${TOOL_TIERS.join(', ')}`);
        }
        policy.maxTier = obj.maxTier as ToolPermission;
    }
    return policy;
}

/** Strictly parse one raw profile into a validated `AgentProfile`. */
export function parseAgentProfile(raw: unknown): AgentProfile {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error('AgentProfile: expected an object');
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
        throw new Error('AgentProfile: `id` is required and must be a non-empty string');
    }
    const profile: AgentProfile = { id: obj.id.trim() };

    if (obj.name !== undefined) {
        if (typeof obj.name !== 'string') throw new Error('AgentProfile: `name` must be a string');
        profile.name = obj.name;
    }
    if (obj.description !== undefined) {
        if (typeof obj.description !== 'string') throw new Error('AgentProfile: `description` must be a string');
        profile.description = obj.description;
    }
    if (obj.model !== undefined) {
        if (typeof obj.model !== 'string' || !obj.model.trim()) {
            throw new Error('AgentProfile: `model` must be a non-empty string');
        }
        profile.model = obj.model.trim();
    }
    if (obj.personality !== undefined) {
        if (typeof obj.personality !== 'string') throw new Error('AgentProfile: `personality` must be a string');
        profile.personality = obj.personality;
    }
    if (obj.memory !== undefined) {
        if (!MEMORY_MODES.includes(obj.memory as ProfileMemoryMode)) {
            throw new Error(`AgentProfile: \`memory\` must be one of ${MEMORY_MODES.join(', ')}`);
        }
        profile.memory = obj.memory as ProfileMemoryMode;
    }
    const tools = parseToolPolicy(obj.tools);
    if (tools) profile.tools = tools;

    return profile;
}

/** Fill defaults to produce the effective profile the runner enforces. */
export function resolveDefaults(profile: AgentProfile): ResolvedProfile {
    return {
        id: profile.id,
        name: profile.name ?? profile.id,
        description: profile.description ?? '',
        ...(profile.model !== undefined && { model: profile.model }),
        ...(profile.personality !== undefined && { personality: profile.personality }),
        memory: profile.memory ?? 'read-write',
        tools: {
            allow: profile.tools?.allow ?? [],
            deny: profile.tools?.deny ?? [],
            ...(profile.tools?.maxTier !== undefined && { maxTier: profile.tools.maxTier }),
        },
    };
}

/**
 * Build the effective profile map: built-ins first, then config overrides.
 * Always guarantees a `default` profile is present.
 */
export function loadProfiles(configProfiles?: unknown[]): Map<string, AgentProfile> {
    const map = new Map<string, AgentProfile>();
    for (const builtin of BUILTIN_PROFILES) map.set(builtin.id, builtin);

    if (Array.isArray(configProfiles)) {
        for (const raw of configProfiles) {
            const parsed = parseAgentProfile(raw);
            map.set(parsed.id, parsed);
        }
    }

    // `default` must always exist and stay unconstrained-by-default; if a user
    // overrode it we respect their override, otherwise keep the built-in.
    if (!map.has(DEFAULT_PROFILE_ID)) map.set(DEFAULT_PROFILE_ID, DEFAULT_PROFILE);

    return map;
}
