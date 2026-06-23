import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { classifyConnectionError, testMcpConnection } from '../test-connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK = join(__dirname, 'fixtures/mock-server.mjs');

describe('classifyConnectionError', () => {
    it('maps spawn ENOENT to command_not_found', () => {
        expect(classifyConnectionError(new Error('spawn foo ENOENT'))).toBe('command_not_found');
        expect(classifyConnectionError(new Error('MCP server "x" failed to spawn (ENOENT: ...)'))).toBe(
            'command_not_found',
        );
    });

    it('maps timeouts and exits and bad rpc', () => {
        expect(classifyConnectionError(new Error('request "initialize" timed out after 12000ms'))).toBe('timeout');
        expect(classifyConnectionError(new Error('server "x" exited (code=1)'))).toBe('process_exited');
        expect(classifyConnectionError(new Error('Invalid JSON from server'))).toBe('invalid_rpc');
    });

    it('falls back to unknown', () => {
        expect(classifyConnectionError(new Error('something weird'))).toBe('unknown');
    });
});

describe('testMcpConnection', () => {
    it('returns ok with the tool list for a working server', async () => {
        const res = await testMcpConnection(
            { command: process.execPath, args: [MOCK] },
            { timeoutMs: 5_000 },
        );
        expect(res.ok).toBe(true);
        expect(res.code).toBe('ok');
        expect(res.toolCount).toBe(1);
        expect(res.tools?.[0].name).toBe('echo');
    });

    it('reports command_not_found for a missing binary', async () => {
        const res = await testMcpConnection(
            { command: 'definitely-not-a-real-binary-xyz' },
            { timeoutMs: 5_000 },
        );
        expect(res.ok).toBe(false);
        expect(res.code).toBe('command_not_found');
    });

    it('reports cwd_not_found before spawning', async () => {
        const res = await testMcpConnection({
            command: process.execPath,
            args: [MOCK],
            cwd: '/path/that/does/not/exist/xyz',
        });
        expect(res.code).toBe('cwd_not_found');
    });

    it('reports missing_secret when an env value is empty', async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'conn-'));
        const res = await testMcpConnection({
            command: process.execPath,
            args: [MOCK],
            cwd: tmp,
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
        });
        expect(res.code).toBe('missing_secret');
        expect(res.message).toContain('GITHUB_PERSONAL_ACCESS_TOKEN');
    });

    it('reports command_not_found for an empty command', async () => {
        const res = await testMcpConnection({ command: '' });
        expect(res.code).toBe('command_not_found');
    });
});
