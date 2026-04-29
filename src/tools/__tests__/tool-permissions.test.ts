import { describe, it, expect } from 'vitest';
import { resolveToolPermission, isAllowedInPlanMode } from '../tool-permissions.js';
import type { Tool } from '../../llm/types.js';

function fakeTool(permission?: 'read' | 'write' | 'dangerous'): Tool {
    return {
        declaration: { name: 'x', description: '', parameters: { type: 'object', properties: {} } },
        handler: async () => '',
        meta: permission ? { permission } : undefined,
    };
}

describe('resolveToolPermission', () => {
    it('prefers explicit meta.permission', () => {
        expect(resolveToolPermission('whatever', fakeTool('read'))).toBe('read');
        expect(resolveToolPermission('whatever', fakeTool('dangerous'))).toBe('dangerous');
    });

    it('falls back to built-in mapping', () => {
        expect(resolveToolPermission('bash')).toBe('dangerous');
        expect(resolveToolPermission('read_file')).toBe('read');
        expect(resolveToolPermission('write_file')).toBe('write');
        expect(resolveToolPermission('list_dir')).toBe('read');
    });

    it('uses name heuristics for unknown tools', () => {
        expect(resolveToolPermission('search_stuff')).toBe('read');
        expect(resolveToolPermission('get_thing')).toBe('read');
        expect(resolveToolPermission('save_state')).toBe('write');
        expect(resolveToolPermission('exec_script')).toBe('dangerous');
    });

    it('defaults unknown tools to write', () => {
        expect(resolveToolPermission('totally_mystery')).toBe('write');
    });
});

describe('isAllowedInPlanMode', () => {
    it('allows read-tier tools', () => {
        expect(isAllowedInPlanMode('read_file')).toBe(true);
        expect(isAllowedInPlanMode('search_something')).toBe(true);
    });

    it('blocks write and dangerous tools', () => {
        expect(isAllowedInPlanMode('bash')).toBe(false);
        expect(isAllowedInPlanMode('write_file')).toBe(false);
    });

    it('always allows exit_plan_mode', () => {
        expect(isAllowedInPlanMode('exit_plan_mode')).toBe(true);
    });
});
