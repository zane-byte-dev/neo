import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveModel, loadSystemInstruction, buildTenantSystemInstruction } from '../client.js';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('resolveModel', () => {
    it('"deepseek" → "deepseek-chat"', () => {
        expect(resolveModel('deepseek')).toBe('deepseek-chat');
    });

    it('"claude-code" → Claude Code compatible Sonnet endpoint model', () => {
        expect(resolveModel('claude-code')).toBe('claude-code/claude-sonnet-4-5');
        expect(resolveModel('claude-code-haiku')).toBe('claude-code/claude-haiku-4-5');
    });

    it('unknown alias returned as-is', () => {
        expect(resolveModel('my-custom-model')).toBe('my-custom-model');
    });
});

describe('loadSystemInstruction', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'llm-test-'));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads AGENTS.md from directory', async () => {
        writeFileSync(join(tmpDir, 'AGENTS.md'), 'You are a helpful agent.', 'utf8');
        const result = await loadSystemInstruction(tmpDir);
        expect(result).toContain('You are a helpful agent.');
    });

    it('merges AGENTS.md + SOUL.md + TOOLS.md', async () => {
        writeFileSync(join(tmpDir, 'AGENTS.md'), 'Agent prompt', 'utf8');
        writeFileSync(join(tmpDir, 'SOUL.md'), 'Soul prompt', 'utf8');
        writeFileSync(join(tmpDir, 'TOOLS.md'), 'Tools prompt', 'utf8');
        const result = await loadSystemInstruction(tmpDir);
        expect(result).toContain('Agent prompt');
        expect(result).toContain('Soul prompt');
        expect(result).toContain('Tools prompt');
    });

    it('falls back to agent.md when AGENTS.md not found', async () => {
        writeFileSync(join(tmpDir, 'agent.md'), 'Legacy prompt', 'utf8');
        const result = await loadSystemInstruction(tmpDir);
        expect(result).toBe('Legacy prompt');
    });

    it('returns empty string when no config files exist', async () => {
        const result = await loadSystemInstruction(tmpDir);
        expect(result).toBe('');
    });
});

describe('buildTenantSystemInstruction', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'tenant-test-'));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('combines system instruction + USER.md', async () => {
        writeFileSync(join(tmpDir, 'AGENTS.md'), 'Base instruction', 'utf8');
        writeFileSync(join(tmpDir, 'USER.md'), 'User is a developer.', 'utf8');

        const result = await buildTenantSystemInstruction(tmpDir);
        expect(result).toContain('Base instruction');
        expect(result).toContain('[用户档案]');
        expect(result).toContain('User is a developer.');
    });

    it('works without USER.md', async () => {
        writeFileSync(join(tmpDir, 'AGENTS.md'), 'Base instruction', 'utf8');
        const result = await buildTenantSystemInstruction(tmpDir);
        expect(result).toContain('Base instruction');
        expect(result).not.toContain('[用户档案]');
    });
});
