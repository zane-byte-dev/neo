/**
 * Unit tests for small utility modules previously at 0% coverage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'utils-batch-'));
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────── workspace ──

describe('resolveUserWorkspaceDir', () => {
    it('joins base dir with user id', async () => {
        const { resolveUserWorkspaceDir } = await import('../../utils/workspace.js');
        const out = resolveUserWorkspaceDir('/data', 'user-1');
        expect(out).toMatch(/[/\\]data[/\\]user-1$/);
    });

    it('preserves absolute base path', async () => {
        const { resolveUserWorkspaceDir } = await import('../../utils/workspace.js');
        expect(resolveUserWorkspaceDir(tmp, 'abc')).toBe(join(tmp, 'abc'));
    });
});

// ──────────────────────────────────────────────────────────── audit-logger ──

describe('logDangerousCommand', () => {
    it('logs at warn level when command is allowed', async () => {
        const { logDangerousCommand } = await import('../../utils/audit-logger.js');
        const logger = await import('../../utils/logger.js');
        const spy = vi.spyOn(logger.log, 'warn').mockImplementation(() => {});
        await logDangerousCommand('rm -rf /tmp/xyz', false);
        expect(spy).toHaveBeenCalledWith(
            'bash',
            'DANGEROUS_COMMAND_EXECUTED',
            expect.objectContaining({ command: expect.stringContaining('rm -rf') }),
        );
    });

    it('logs at critical level when command is blocked', async () => {
        const { logDangerousCommand } = await import('../../utils/audit-logger.js');
        const logger = await import('../../utils/logger.js');
        const spy = vi.spyOn(logger.log, 'critical').mockImplementation(() => {});
        await logDangerousCommand('rm -rf /', true, 'whitelist miss');
        expect(spy).toHaveBeenCalledWith(
            'bash',
            'DANGEROUS_COMMAND_BLOCKED',
            expect.objectContaining({ reason: 'whitelist miss' }),
        );
    });

    it('truncates very long commands to 500 chars', async () => {
        const { logDangerousCommand } = await import('../../utils/audit-logger.js');
        const logger = await import('../../utils/logger.js');
        const spy = vi.spyOn(logger.log, 'warn').mockImplementation(() => {});
        await logDangerousCommand('x'.repeat(2000), false);
        const call = spy.mock.calls[0];
        expect((call[2] as any).command.length).toBe(500);
    });
});

// ───────────────────────────────────────────────────────────── auto-loader ──

describe('autoLoad', () => {
    it('imports modules and filters via predicate', async () => {
        // Use an absolute file:// import path so vitest runs the dynamic import as ESM.
        // We can lay a tiny module tree under tmp.
        const subDir = join(tmp, 'mods');
        mkdirSync(subDir);
        writeFileSync(join(subDir, 'a.js'), 'export const tag = { kind: "tool", id: "a" };');
        writeFileSync(join(subDir, 'b.js'), 'export const tag = { kind: "tool", id: "b" };');
        writeFileSync(join(subDir, 'c.js'), 'export const tag = { kind: "other", id: "c" };');
        writeFileSync(join(subDir, '_skip.js'), 'export const tag = { kind: "tool", id: "skip" };');
        writeFileSync(join(subDir, 'index.js'), 'export const tag = { kind: "tool", id: "index" };');

        const { autoLoad } = await import('../../utils/auto-loader.js');
        const isTool = (v: unknown): v is { kind: string; id: string } =>
            typeof v === 'object' && v !== null && (v as any).kind === 'tool';
        const results = await autoLoad(subDir, isTool);
        const ids = results.map(r => r.id).sort();
        expect(ids).toEqual(['a', 'b']);
    });

    it('recurses into subdirectories', async () => {
        const root = join(tmp, 'mods');
        const sub = join(root, 'nested');
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(root, 'top.js'), 'export const tag = { kind: "tool", id: "top" };');
        writeFileSync(join(sub, 'deep.js'), 'export const tag = { kind: "tool", id: "deep" };');

        const { autoLoad } = await import('../../utils/auto-loader.js');
        const isTool = (v: unknown): v is { kind: string; id: string } =>
            typeof v === 'object' && v !== null && (v as any).kind === 'tool';
        const ids = (await autoLoad(root, isTool)).map(r => r.id).sort();
        expect(ids).toEqual(['deep', 'top']);
    });
});

// ─────────────────────────────────────────────────────────── token-tracker ──

describe('getMonthlyUsage', () => {
    it('returns empty summary when log file does not exist', async () => {
        const { getMonthlyUsage } = await import('../../utils/token-tracker.js');
        const summary = await getMonthlyUsage('1900-01');
        expect(summary.month).toBe('1900-01');
        expect(summary.callCount).toBe(0);
        expect(summary.totalTokens).toBe(0);
        expect(summary.byModel).toEqual({});
    });

    it('aggregates usage across multiple entries', async () => {
        const logsDir = join(process.cwd(), 'logs');
        await fs.mkdir(logsDir, { recursive: true });
        const month = '2099-12';
        const file = join(logsDir, `token-usage-${month}.jsonl`);
        const entries = [
            { ts: 't1', model: 'gemini-flash', promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            { ts: 't2', model: 'gemini-flash', promptTokens: 200, completionTokens: 80, totalTokens: 280 },
            { ts: 't3', model: 'deepseek',     promptTokens: 50,  completionTokens: 20, totalTokens: 70 },
        ];
        await fs.writeFile(file, entries.map(e => JSON.stringify(e)).join('\n'), 'utf8');
        try {
            const { getMonthlyUsage } = await import('../../utils/token-tracker.js');
            const summary = await getMonthlyUsage(month);
            expect(summary.callCount).toBe(3);
            expect(summary.totalPromptTokens).toBe(350);
            expect(summary.totalCompletionTokens).toBe(150);
            expect(summary.totalTokens).toBe(500);
            expect(summary.byModel['gemini-flash'].callCount).toBe(2);
            expect(summary.byModel.deepseek.callCount).toBe(1);
        } finally {
            await fs.rm(file, { force: true });
        }
    });

    it('recordTokenUsage appends a jsonl line in the current month file', async () => {
        const logsDir = join(process.cwd(), 'logs');
        await fs.mkdir(logsDir, { recursive: true });
        const month = new Date().toISOString().slice(0, 7);
        const file = join(logsDir, `token-usage-${month}.jsonl`);
        // remove any prior content for this month so we can isolate our line
        const before = await fs.readFile(file, 'utf8').catch(() => '');
        const marker = `marker-${Math.random()}`;
        const { recordTokenUsage } = await import('../../utils/token-tracker.js');
        recordTokenUsage({
            ts: new Date().toISOString(),
            model: marker,
            promptTokens: 1, completionTokens: 2, totalTokens: 3,
        });
        // Allow the fire-and-forget appendFile to flush
        await new Promise((r) => setTimeout(r, 60));
        const after = await fs.readFile(file, 'utf8');
        expect(after.length).toBeGreaterThan(before.length);
        expect(after).toContain(marker);
        // restore previous file content to avoid leaking test data
        await fs.writeFile(file, before, 'utf8');
    });
});
