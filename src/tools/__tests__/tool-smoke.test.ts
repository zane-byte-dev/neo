/**
 * Smoke tests for tool-related modules whose handlers depend on external CLIs
 * or sandboxes. We only exercise the cheap declaration/early-error branches.
 */
import { describe, it, expect, vi } from 'vitest';

describe('code_exec tool', () => {
    it('declaration is well-formed', async () => {
        const { codeExecTool } = await import('../../tools/internal/code-exec.js');
        expect(codeExecTool.declaration.name).toBe('code_exec');
        expect(codeExecTool.declaration.parameters.required).toEqual(['language', 'code']);
        expect(codeExecTool.meta?.permission).toBe('dangerous');
    });

    it('returns "(empty code)" when code is blank', async () => {
        const { codeExecTool } = await import('../../tools/internal/code-exec.js');
        const out = await codeExecTool.handler({ language: 'python', code: '   ' }, '/tmp', undefined);
        expect(out).toBe('(empty code)');
    });

    it('errors when session context is missing', async () => {
        const { codeExecTool } = await import('../../tools/internal/code-exec.js');
        const out = await codeExecTool.handler({ language: 'python', code: 'print(1)' }, '/tmp', undefined);
        expect(out).toContain('requires a session context');
    });
});

describe('subagent tool', () => {
    it('declaration shape', async () => {
        const { subagent } = await import('../../tools/internal/subagent.js');
        expect(subagent.declaration.name).toBe('subagent');
        expect(subagent.declaration.parameters.required).toEqual(['task']);
    });

    it('errors when task is empty', async () => {
        const { subagent } = await import('../../tools/internal/subagent.js');
        const out = await subagent.handler({ task: '   ' }, '/tmp', { userId: 'u', sessionId: 's' });
        expect(String(out)).toContain('task is required');
    });
});

describe('generate_video tool', () => {
    it('declaration shape and disabled when no GEMINI_API_KEY', async () => {
        const { generateVideoTool } = await import('../../tools/internal/generate-video.js');
        expect(generateVideoTool.declaration.name).toBe('generate_video');
        expect(generateVideoTool.declaration.parameters.required).toEqual(['prompt']);
        expect(generateVideoTool.meta?.requiresEnv).toContain('GEMINI_API_KEY');
    });

    it('errors when prompt is empty', async () => {
        const { generateVideoTool } = await import('../../tools/internal/generate-video.js');
        const out = await generateVideoTool.handler({ prompt: '' }, '/tmp', undefined);
        expect(String(out)).toContain('prompt is required');
    });
});

describe('browser_command tool', () => {
    it('declaration shape', async () => {
        const { browserCommandTool } = await import('../../tools/internal/browser.js');
        expect(browserCommandTool.declaration.name).toBe('browser_command');
        expect(browserCommandTool.meta?.permission).toBe('dangerous');
    });

    it('errors when command is missing/empty', async () => {
        const { browserCommandTool } = await import('../../tools/internal/browser.js');
        const out = await browserCommandTool.handler({}, '/tmp', { userId: 'u', sessionId: 's' });
        expect(String(out).toLowerCase()).toMatch(/command|error|require/);
    });
});

describe('tools/_base re-exports types', () => {
    it('module loads without side effects', async () => {
        const mod = await import('../../tools/_base.js');
        // It's a type-only re-export; the runtime module is empty
        expect(mod).toBeDefined();
    });
});

describe('tools/index.setupTools', () => {
    it('exports a setupTools function', async () => {
        const mod = await import('../../tools/index.js');
        expect(typeof mod.setupTools).toBe('function');
    });
});
