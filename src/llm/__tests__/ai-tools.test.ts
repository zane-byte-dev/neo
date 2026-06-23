import { describe, it, expect } from 'vitest';
import { buildAiTools, buildAiToolSubset } from '../ai-tools.js';
import type { Tool, ToolContext } from '../types.js';

function makeTool(name: string, permission: 'read' | 'write' | 'dangerous' = 'read'): Tool {
    return {
        declaration: {
            name,
            description: `desc-${name}`,
            parameters: { type: 'object', properties: {} },
        },
        handler: async () => `ran-${name}`,
        meta: { permission },
    };
}

const baseCtx: ToolContext = {
    userId: 'u', sessionId: 's', workDir: '/tmp', stateDir: '/tmp', systemInstruction: '',
} as ToolContext;

describe('buildAiTools', () => {
    it('includes built-in declarations and registry tools', () => {
        const reg = new Map<string, Tool>([['my_tool', makeTool('my_tool')]]);
        const out = buildAiTools(reg, '/tmp', baseCtx);
        expect(out).toHaveProperty('bash');
        expect(out).toHaveProperty('read_file');
        expect(out).toHaveProperty('my_tool');
    });

    it('omits dangerous and write tools in plan mode (keeps read tools + exit_plan_mode)', () => {
        const reg = new Map<string, Tool>([
            ['danger_tool', makeTool('danger_tool', 'dangerous')],
            ['safe_tool', makeTool('safe_tool', 'read')],
            ['exit_plan_mode', makeTool('exit_plan_mode', 'read')],
        ]);
        const planCtx = { ...baseCtx, mode: 'plan' as const };
        const out = buildAiTools(reg, '/tmp', planCtx);
        expect(out).not.toHaveProperty('bash'); // dangerous built-in
        expect(out).not.toHaveProperty('write_file'); // write built-in
        expect(out).toHaveProperty('read_file'); // read built-in
        expect(out).toHaveProperty('safe_tool');
        expect(out).not.toHaveProperty('danger_tool');
        expect(out).toHaveProperty('exit_plan_mode');
    });

    it('includes per-user tools from context.userTools', () => {
        const userTools = new Map<string, Tool>([['user_thing', makeTool('user_thing')]]);
        const ctx = { ...baseCtx, userTools };
        const out = buildAiTools(new Map(), '/tmp', ctx);
        expect(out).toHaveProperty('user_thing');
    });
});

describe('buildAiToolSubset', () => {
    it('returns all tools when names is empty', () => {
        const reg = new Map<string, Tool>([['a', makeTool('a')]]);
        const out = buildAiToolSubset([], reg, '/tmp', baseCtx);
        expect(out).toHaveProperty('a');
        expect(out).toHaveProperty('read_file');
    });

    it('limits to the requested names and skips unknown', () => {
        const reg = new Map<string, Tool>([
            ['a', makeTool('a')],
            ['b', makeTool('b')],
        ]);
        const out = buildAiToolSubset(['a', 'does_not_exist', 'read_file'], reg, '/tmp', baseCtx);
        expect(Object.keys(out).sort()).toEqual(['a', 'read_file']);
    });
});

function exec(t: unknown, args: Record<string, unknown> = {}): Promise<string> {
    // AI SDK CoreTool exposes an async `execute(args, options)`.
    return (t as { execute: (a: unknown, o: unknown) => Promise<string> }).execute(args, {});
}

describe('buildAiTools — error classification hint injection', () => {
    function resultTool(name: string, result: string): Tool {
        return {
            declaration: { name, description: 'd', parameters: { type: 'object', properties: {} } },
            handler: async () => result,
            meta: { permission: 'read' },
        };
    }

    it('appends a structured hint to a failed result', async () => {
        const reg = new Map<string, Tool>([['boom', resultTool('boom', '[Error] HTTP 403 — denied')]]);
        const out = buildAiTools(reg, '/tmp', baseCtx);
        const res = await exec(out.boom);
        expect(res).toContain('[Error] HTTP 403');
        expect(res).toContain('[ToolError] type=permanent retryable=false');
    });

    it('does not append a hint to a successful result', async () => {
        const reg = new Map<string, Tool>([['ok', resultTool('ok', 'all good here')]]);
        const out = buildAiTools(reg, '/tmp', baseCtx);
        const res = await exec(out.ok);
        expect(res).toBe('all good here');
        expect(res).not.toContain('[ToolError]');
    });

    it('classifies a thrown handler error and surfaces a hint', async () => {
        const thrower: Tool = {
            declaration: { name: 'throws', description: 'd', parameters: { type: 'object', properties: {} } },
            handler: async () => {
                throw new Error('connection reset by peer');
            },
            meta: { permission: 'read' },
        };
        const reg = new Map<string, Tool>([['throws', thrower]]);
        const out = buildAiTools(reg, '/tmp', baseCtx);
        const res = await exec(out.throws);
        expect(res).toContain('connection reset by peer');
        expect(res).toContain('[ToolError] type=transient retryable=true');
    });

    it('honors a per-tool classifyError override', async () => {
        const overridden: Tool = {
            declaration: { name: 'ov', description: 'd', parameters: { type: 'object', properties: {} } },
            handler: async () => '[Error] HTTP 503 transient-looking',
            meta: {
                permission: 'read',
                classifyError: () => ({ type: 'permanent', retryable: false, suggestion: 'switch source' }),
            },
        };
        const reg = new Map<string, Tool>([['ov', overridden]]);
        const out = buildAiTools(reg, '/tmp', baseCtx);
        const res = await exec(out.ov);
        expect(res).toContain('[ToolError] type=permanent retryable=false');
        expect(res).toContain('switch source');
    });
});
