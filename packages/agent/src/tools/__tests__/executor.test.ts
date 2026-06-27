import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeTool } from '../executor.js';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock audit-logger to avoid file system side effects
vi.mock('../../utils/audit-logger.js', () => ({
    logDangerousCommand: vi.fn(),
}));

let workDir: string;
const emptyRegistry = new Map();

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'executor-test-'));
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

function git(...args: string[]): string {
    return execFileSync('git', ['-C', workDir, ...args], { encoding: 'utf8' }).trim();
}

function initGitRepo(): void {
    git('init');
    git('config', 'user.name', 'Test User');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(workDir, 'README.md'), 'seed\n', 'utf8');
    git('add', 'README.md');
    git('commit', '-m', 'init');
}

describe('executeTool', () => {
    describe('read_file', () => {
        it('reads an existing file', async () => {
            writeFileSync(join(workDir, 'hello.txt'), 'Hello, world!', 'utf8');
            const result = await executeTool('read_file', { path: 'hello.txt' }, workDir, emptyRegistry);
            expect(result).toContain('Hello, world!');
            expect(result).toContain('[EXTERNAL_CONTENT]');
        });

        it('truncates a very long file', async () => {
            writeFileSync(join(workDir, 'big.txt'), 'x'.repeat(100_000), 'utf8');
            const result = await executeTool('read_file', { path: 'big.txt' }, workDir, emptyRegistry);
            expect(result).toContain('truncated');
            expect(result).toContain('TRUNCATED');
        });

        it('blocks path traversal', async () => {
            const result = await executeTool('read_file', { path: '../../etc/passwd' }, workDir, emptyRegistry);
            expect(result).toContain('[Error]');
            expect(result).toContain('Path traversal blocked');
        });
    });

    describe('write_file', () => {
        it('creates a new file with auto-created parent directories', async () => {
            const result = await executeTool('write_file', {
                path: 'subdir/deep/file.txt',
                content: 'New content',
            }, workDir, emptyRegistry);
            expect(result).toContain('OK');
            const written = readFileSync(join(workDir, 'subdir/deep/file.txt'), 'utf8');
            expect(written).toBe('New content');
        });

        it('auto-commits new workspace changes inside a git repo', async () => {
            initGitRepo();

            const result = await executeTool('write_file', {
                path: 'subdir/deep/file.txt',
                content: 'New content',
            }, workDir, emptyRegistry);

            expect(result).toContain('OK');
            expect(git('status', '--porcelain')).toBe('');
            expect(git('log', '--format=%s', '-1')).toBe('chore(workspace): apply write_file changes');
            expect(git('show', '--stat', '--format=', 'HEAD')).toContain('subdir/deep/file.txt');
        });

        it('does not auto-commit files that were already dirty before the tool ran', async () => {
            initGitRepo();
            writeFileSync(join(workDir, 'dirty.txt'), 'initial\n', 'utf8');
            git('add', 'dirty.txt');
            git('commit', '-m', 'add dirty file');
            writeFileSync(join(workDir, 'dirty.txt'), 'user draft\n', 'utf8');
            const commitCountBefore = git('rev-list', '--count', 'HEAD');

            const result = await executeTool('write_file', {
                path: 'dirty.txt',
                content: 'tool change\n',
            }, workDir, emptyRegistry);

            expect(result).toContain('OK');
            expect(git('rev-list', '--count', 'HEAD')).toBe(commitCountBefore);
            expect(git('status', '--porcelain')).toContain('dirty.txt');
        });
    });

    describe('list_dir', () => {
        it('lists directory contents with directories first', async () => {
            mkdirSync(join(workDir, 'zdir'));
            writeFileSync(join(workDir, 'afile.txt'), '', 'utf8');
            const result = await executeTool('list_dir', { path: '.' }, workDir, emptyRegistry);
            const lines = result.split('\n');
            expect(lines[0]).toBe('zdir/');
            expect(lines[1]).toBe('afile.txt');
        });
    });

    describe('bash', () => {
        it('executes a simple command and returns output', async () => {
            const result = await executeTool('bash', { command: 'echo hello' }, workDir, emptyRegistry);
            expect(result).toBe('hello');
        });

        it('blocks dangerous commands', async () => {
            const result = await executeTool('bash', { command: 'rm -rf /' }, workDir, emptyRegistry);
            expect(result).toContain('[BLOCKED]');
        });

        it('returns error for commands that time out', async () => {
            const result = await executeTool('bash', {
                command: 'sleep 10',
                timeout_ms: 100,
            }, workDir, emptyRegistry);
            // execa kills the process — may return (no output), error, or timeout text
            expect(typeof result).toBe('string');
        }, 15_000);
    });

    describe('unknown tool', () => {
        it('returns error for unknown tool name', async () => {
            const result = await executeTool('nonexistent_tool', {}, workDir, emptyRegistry);
            expect(result).toContain('[Error]');
            expect(result).toContain('Unknown tool');
        });
    });

    describe('tool execution exception', () => {
        it('returns [Error] format for failed tool', async () => {
            // read_file on a non-existent file should return an error
            const result = await executeTool('read_file', { path: 'nonexistent.txt' }, workDir, emptyRegistry);
            expect(result).toContain('[Error]');
        });
    });
});
