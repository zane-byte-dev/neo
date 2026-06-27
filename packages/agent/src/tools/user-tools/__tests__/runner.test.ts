import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRunScript, runToolScript } from '../runner.js';
import type { ToolContext } from '../../../llm/types.js';

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'utr-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const ctx: ToolContext = {
    userId: 'u1', sessionId: 's1', workDir: '/tmp', stateDir: '/tmp', systemInstruction: '',
} as ToolContext;

describe('findRunScript', () => {
    it('returns null when no run.* exists', async () => {
        expect(await findRunScript(dir)).toBeNull();
    });

    it('finds run.sh', async () => {
        const p = join(dir, 'run.sh');
        await fs.writeFile(p, '#!/bin/sh\necho hi', 'utf8');
        expect(await findRunScript(dir)).toBe(p);
    });

    it('prefers run.py first when multiple exist', async () => {
        await fs.writeFile(join(dir, 'run.sh'), '#!/bin/sh\necho sh', 'utf8');
        await fs.writeFile(join(dir, 'run.py'), 'print("py")', 'utf8');
        const found = await findRunScript(dir);
        expect(found).toBe(join(dir, 'run.py'));
    });
});

describe('runToolScript', () => {
    it('runs a shell script that emits valid JSON', async () => {
        const sh = join(dir, 'run.sh');
        await fs.writeFile(sh, '#!/bin/sh\necho \'{"type":"text","content":"hello"}\'\n', 'utf8');
        chmodSync(sh, 0o755);
        const out = await runToolScript(dir, sh, { foo: 'bar' }, ctx);
        expect(out.type).toBe('text');
        expect(out.content).toBe('hello');
    });

    it('returns plain text when stdout is not JSON', async () => {
        const sh = join(dir, 'run.sh');
        await fs.writeFile(sh, '#!/bin/sh\necho "just text"\n', 'utf8');
        chmodSync(sh, 0o755);
        const out = await runToolScript(dir, sh, {}, ctx);
        expect(out.type).toBe('text');
        expect(out.content).toContain('just text');
    });

    it('returns error result when the script exits non-zero', async () => {
        const sh = join(dir, 'run.sh');
        await fs.writeFile(sh, '#!/bin/sh\necho "boom" 1>&2\nexit 3\n', 'utf8');
        chmodSync(sh, 0o755);
        const out = await runToolScript(dir, sh, {}, ctx);
        expect(out.type).toBe('error');
        expect(out.content).toContain('boom');
    });

    it('returns "(no output)" when stdout is empty on success', async () => {
        const sh = join(dir, 'run.sh');
        await fs.writeFile(sh, '#!/bin/sh\nexit 0\n', 'utf8');
        chmodSync(sh, 0o755);
        const out = await runToolScript(dir, sh, {}, ctx);
        expect(out.type).toBe('text');
        expect(out.content).toBe('(no output)');
    });

    it('passes context env vars to the child process', async () => {
        const sh = join(dir, 'run.sh');
        await fs.writeFile(
            sh,
            '#!/bin/sh\necho "{\\"type\\":\\"text\\",\\"content\\":\\"$TOOL_USER_ID:$TOOL_SESSION_ID\\"}"\n',
            'utf8',
        );
        chmodSync(sh, 0o755);
        const out = await runToolScript(dir, sh, {}, ctx);
        expect(out.content).toBe('u1:s1');
    });

    it('returns error when execution itself fails (missing runtime)', async () => {
        // Force an unsupported runtime by giving it an unknown extension that detectRuntime maps to shell
        // Then point to a non-existent script path so execa fails
        const out = await runToolScript(dir, '/no/such/run.sh', {}, ctx);
        expect(out.type).toBe('error');
    });
});
