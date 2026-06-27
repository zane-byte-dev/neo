/**
 * Unit tests for the agent profiles module: loader validation, resolver
 * precedence, default-fill, and tool enforcement ordering.
 */

import { describe, expect, it } from 'vitest';
import {
    loadProfiles,
    parseAgentProfile,
    resolveDefaults,
} from '../loader.js';
import { resolveProfile } from '../resolve.js';
import { isAllowedByProfile } from '../enforcement.js';
import { DEFAULT_PROFILE_ID } from '../builtins.js';
import type { AgentProfile, ResolvedProfile } from '../types.js';
import type { Tool } from '../../../llm/types.js';

describe('profiles/loader — parseAgentProfile', () => {
    it('parses a minimal valid profile', () => {
        const p = parseAgentProfile({ id: 'x' });
        expect(p.id).toBe('x');
    });

    it('trims and validates fields', () => {
        const p = parseAgentProfile({
            id: ' coder ',
            name: 'Coder',
            model: ' deepseek ',
            memory: 'read',
            tools: { allow: [' read_file '], deny: ['bash'], maxTier: 'write' },
        });
        expect(p.id).toBe('coder');
        expect(p.model).toBe('deepseek');
        expect(p.tools?.allow).toEqual(['read_file']);
        expect(p.tools?.deny).toEqual(['bash']);
        expect(p.tools?.maxTier).toBe('write');
    });

    it('rejects missing id', () => {
        expect(() => parseAgentProfile({})).toThrow(/id/);
    });

    it('rejects invalid memory mode', () => {
        expect(() => parseAgentProfile({ id: 'x', memory: 'always' })).toThrow(/memory/);
    });

    it('rejects invalid tier', () => {
        expect(() => parseAgentProfile({ id: 'x', tools: { maxTier: 'super' } })).toThrow(/maxTier/);
    });

    it('rejects non-string allow entries', () => {
        expect(() => parseAgentProfile({ id: 'x', tools: { allow: [1] } })).toThrow(/allow/);
    });
});

describe('profiles/loader — resolveDefaults', () => {
    it('fills memory default to read-write', () => {
        const r = resolveDefaults({ id: 'x' });
        expect(r.memory).toBe('read-write');
        expect(r.tools.allow).toEqual([]);
        expect(r.tools.deny).toEqual([]);
        expect(r.tools.maxTier).toBeUndefined();
    });

    it('preserves explicit values', () => {
        const r = resolveDefaults({ id: 'x', memory: 'off', tools: { maxTier: 'read' } });
        expect(r.memory).toBe('off');
        expect(r.tools.maxTier).toBe('read');
    });
});

describe('profiles/loader — loadProfiles', () => {
    it('always includes built-in default', () => {
        const map = loadProfiles();
        expect(map.has(DEFAULT_PROFILE_ID)).toBe(true);
        expect(map.has('research')).toBe(true);
    });

    it('config profiles override built-ins by id', () => {
        const map = loadProfiles([{ id: 'research', name: 'Custom Research', memory: 'off' }]);
        expect(map.get('research')?.name).toBe('Custom Research');
        expect(map.get('research')?.memory).toBe('off');
    });

    it('throws on malformed config profile', () => {
        expect(() => loadProfiles([{ name: 'no id' }])).toThrow();
    });
});

describe('profiles/resolve — precedence', () => {
    const profiles = loadProfiles([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
    ]);

    it('explicit request wins over binding and default', () => {
        const r = resolveProfile({
            entrypoint: 'web-chat',
            requestedId: 'a',
            profiles,
            bindings: { 'web-chat': 'b' },
        });
        expect(r.id).toBe('a');
    });

    it('entrypoint binding wins over default', () => {
        const r = resolveProfile({
            entrypoint: 'telegram',
            profiles,
            bindings: { telegram: 'b' },
        });
        expect(r.id).toBe('b');
    });

    it('falls back to default with no request/binding', () => {
        const r = resolveProfile({ entrypoint: 'cron', profiles });
        expect(r.id).toBe(DEFAULT_PROFILE_ID);
    });

    it('unknown requested id falls through to binding', () => {
        const r = resolveProfile({
            entrypoint: 'web-chat',
            requestedId: 'does-not-exist',
            profiles,
            bindings: { 'web-chat': 'a' },
        });
        expect(r.id).toBe('a');
    });

    it('unknown binding falls through to default', () => {
        const r = resolveProfile({
            entrypoint: 'webhook',
            profiles,
            bindings: { webhook: 'ghost' },
        });
        expect(r.id).toBe(DEFAULT_PROFILE_ID);
    });
});

describe('profiles/enforcement — isAllowedByProfile', () => {
    const writeTool: Tool = {
        declaration: { name: 'edit_file', description: '', parameters: { type: 'object' } },
        handler: async () => '',
        meta: { permission: 'write' },
    };
    const dangerousTool: Tool = {
        declaration: { name: 'run_cmd', description: '', parameters: { type: 'object' } },
        handler: async () => '',
        meta: { permission: 'dangerous' },
    };

    const mk = (tools: ResolvedProfile['tools']): ResolvedProfile => ({
        id: 't', name: 't', description: '', memory: 'read-write', tools,
    });

    it('default (unconstrained) allows everything', () => {
        const p = mk({ allow: [], deny: [] });
        expect(isAllowedByProfile('read_file', undefined, p)).toBe(true);
        expect(isAllowedByProfile('bash', undefined, p)).toBe(true);
    });

    it('deny always wins, even over allow', () => {
        const p = mk({ allow: ['bash'], deny: ['bash'] });
        expect(isAllowedByProfile('bash', undefined, p)).toBe(false);
    });

    it('maxTier caps by permission tier', () => {
        const p = mk({ allow: [], deny: [], maxTier: 'read' });
        // read_file is a built-in read tool
        expect(isAllowedByProfile('read_file', undefined, p)).toBe(true);
        // bash is a built-in dangerous tool
        expect(isAllowedByProfile('bash', undefined, p)).toBe(false);
        expect(isAllowedByProfile('edit_file', writeTool, p)).toBe(false);
    });

    it('maxTier write blocks dangerous but allows write/read', () => {
        const p = mk({ allow: [], deny: [], maxTier: 'write' });
        expect(isAllowedByProfile('edit_file', writeTool, p)).toBe(true);
        expect(isAllowedByProfile('run_cmd', dangerousTool, p)).toBe(false);
        expect(isAllowedByProfile('read_file', undefined, p)).toBe(true);
    });

    it('non-empty allowlist hides tools not listed', () => {
        const p = mk({ allow: ['read_file'], deny: [] });
        expect(isAllowedByProfile('read_file', undefined, p)).toBe(true);
        expect(isAllowedByProfile('list_dir', undefined, p)).toBe(false);
    });
});
