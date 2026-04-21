import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeTool } from '../executor.js';
import type { Tool } from '../../llm/types.js';

vi.mock('../../utils/audit-logger.js', () => ({
    logDangerousCommand: vi.fn(),
}));

let workDir: string;

beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'confirm-test-')); });
afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

describe('executeTool confirmCallback', () => {
    it('does not prompt for read-tier tools', async () => {
        const confirmCallback = vi.fn(async () => true);
        const result = await executeTool(
            'list_dir', { path: '.' }, workDir, new Map(), {
                userId: 'u', sessionId: 's', workDir, systemInstruction: '', confirmCallback,
            },
        );
        expect(confirmCallback).not.toHaveBeenCalled();
        expect(result).not.toMatch(/DENIED/);
    });

    it('prompts for dangerous-tier tools and blocks when denied', async () => {
        const confirmCallback = vi.fn(async () => false);
        const result = await executeTool(
            'bash', { command: 'echo hi' }, workDir, new Map(), {
                userId: 'u', sessionId: 's', workDir, systemInstruction: '', confirmCallback,
            },
        );
        expect(confirmCallback).toHaveBeenCalledTimes(1);
        expect(result).toMatch(/\[DENIED\]/);
    });

    it('runs dangerous tool when confirmation is granted', async () => {
        const confirmCallback = vi.fn(async () => true);
        const result = await executeTool(
            'bash', { command: 'echo hello' }, workDir, new Map(), {
                userId: 'u', sessionId: 's', workDir, systemInstruction: '', confirmCallback,
            },
        );
        expect(confirmCallback).toHaveBeenCalledTimes(1);
        expect(result).toContain('hello');
    });

    it('consults registry meta.permission for custom tools', async () => {
        const confirmCallback = vi.fn(async () => false);
        const customTool: Tool = {
            declaration: {
                name: 'nuke_everything',
                description: '',
                parameters: { type: 'object', properties: {} },
            },
            meta: { permission: 'dangerous' },
            handler: async () => 'boom',
        };
        const registry = new Map([['nuke_everything', customTool]]);
        const result = await executeTool(
            'nuke_everything', {}, workDir, registry, {
                userId: 'u', sessionId: 's', workDir, systemInstruction: '', confirmCallback,
            },
        );
        expect(confirmCallback).toHaveBeenCalledTimes(1);
        expect(result).toMatch(/\[DENIED\]/);
    });
});
