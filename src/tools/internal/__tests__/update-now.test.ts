import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateNowTool } from '../update-now.js';
import type { ToolContext } from '../../../llm/types.js';

let stateDir: string;
let ctx: ToolContext;

beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'now-test-'));
    ctx = {
        userId: 'u1', sessionId: 's1', workDir: stateDir, stateDir,
        systemInstruction: '',
    } as ToolContext;
});

afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
});

describe('update_now tool', () => {
    it('read returns placeholder when NOW.md does not exist', async () => {
        const out = await updateNowTool.handler({ action: 'read' }, stateDir, ctx);
        expect(out).toContain('尚未创建');
    });

    it('write creates the file with a trailing Updated stamp', async () => {
        const out = await updateNowTool.handler(
            { action: 'write', content: 'Focusing on milestone X' },
            stateDir, ctx,
        );
        expect(out).toContain('已覆写');
        const body = await fs.readFile(join(stateDir, 'memory', 'NOW.md'), 'utf8');
        expect(body).toContain('Focusing on milestone X');
        expect(body).toMatch(/\*Updated:\s*\d{4}\/\d{2}\/\d{2}\*/);
    });

    it('read returns the content after a write', async () => {
        await updateNowTool.handler({ action: 'write', content: 'hello' }, stateDir, ctx);
        const out = await updateNowTool.handler({ action: 'read' }, stateDir, ctx);
        expect(out).toContain('hello');
        expect(out).toContain('NOW.md');
    });

    it('patch appends content and refreshes the stamp (only one Updated footer)', async () => {
        await updateNowTool.handler({ action: 'write', content: 'first' }, stateDir, ctx);
        await updateNowTool.handler({ action: 'patch', content: 'second' }, stateDir, ctx);
        const body = await fs.readFile(join(stateDir, 'memory', 'NOW.md'), 'utf8');
        expect(body).toContain('first');
        expect(body).toContain('second');
        const stamps = body.match(/\*Updated:/g) ?? [];
        expect(stamps.length).toBe(1);
    });

    it('rejects unknown action', async () => {
        const out = await updateNowTool.handler({ action: 'nope' }, stateDir, ctx);
        expect(out).toContain('[Error]');
    });

    it('write/patch require non-empty content', async () => {
        const out = await updateNowTool.handler({ action: 'write', content: '' }, stateDir, ctx);
        expect(out).toContain('[Error]');
    });

    it('rejects content that exceeds the byte cap', async () => {
        const big = 'a'.repeat(5 * 1024);
        const out = await updateNowTool.handler({ action: 'write', content: big }, stateDir, ctx);
        expect(out).toContain('[Error]');
        expect(out).toContain('字节上限');
    });
});
