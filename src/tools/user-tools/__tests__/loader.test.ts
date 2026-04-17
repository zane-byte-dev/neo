import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadUserTools } from '../loader.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Mock runner.ts so we don't need real scripts to execute
vi.mock('../runner.js', () => ({
    findRunScript: async (toolDir: string) => {
        const { existsSync } = await import('node:fs');
        for (const name of ['run.py', 'run.ts', 'run.js', 'run.sh']) {
            const p = `${toolDir}/${name}`;
            if (existsSync(p)) return p;
        }
        return null;
    },
    runToolScript: async () => ({ type: 'text', content: 'ok' }),
}));

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loader-test-'));
});

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

function makeToolDir(name: string, yamlContent?: string, scriptName?: string) {
    const toolDir = join(tmpDir, '.tools', name);
    mkdirSync(toolDir, { recursive: true });
    if (yamlContent !== undefined) {
        writeFileSync(join(toolDir, 'tool.yaml'), yamlContent, 'utf8');
    }
    if (scriptName) {
        writeFileSync(join(toolDir, scriptName), '#!/bin/sh\necho ok', 'utf8');
    }
}

describe('loadUserTools', () => {
    it('returns empty Map when .tools/ does not exist', async () => {
        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(0);
    });

    it('correctly parses tool.yaml into a Tool object', async () => {
        makeToolDir('hello', `name: hello\ndescription: Say hello\nparameters:\n  name:\n    type: string\n    description: Who to greet`, 'run.sh');

        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(1);
        const tool = result.get('hello');
        expect(tool).toBeDefined();
        expect(tool!.declaration.name).toBe('hello');
        expect(tool!.declaration.description).toBe('Say hello');
    });

    it('skips directories without tool.yaml', async () => {
        const toolDir = join(tmpDir, '.tools', 'notool');
        mkdirSync(toolDir, { recursive: true });
        writeFileSync(join(toolDir, 'run.sh'), '#!/bin/sh\necho ok', 'utf8');

        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(0);
    });

    it('skips directories without run script', async () => {
        makeToolDir('norun', 'name: norun\ndescription: No runner');
        // No run.sh/run.py/run.ts/run.js

        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(0);
    });

    it('skips directories with empty tool.yaml', async () => {
        makeToolDir('empty', '', 'run.sh');

        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(0);
    });

    it('skips directories starting with _', async () => {
        makeToolDir('_hidden', 'name: hidden\ndescription: Hidden tool', 'run.sh');

        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(0);
    });

    it('skips tool.yaml missing name and warns', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        makeToolDir('noname', 'description: Missing name field', 'run.sh');

        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(0);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('loads multiple tools', async () => {
        makeToolDir('alpha', 'name: alpha\ndescription: Tool A', 'run.sh');
        makeToolDir('beta', 'name: beta\ndescription: Tool B', 'run.py');

        const result = await loadUserTools(tmpDir);
        expect(result.size).toBe(2);
        expect(result.has('alpha')).toBe(true);
        expect(result.has('beta')).toBe(true);
    });
});
