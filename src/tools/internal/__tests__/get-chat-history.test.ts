import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getChatHistoryTool } from '../get-chat-history.js';
import type { ToolContext } from '../../../llm/types.js';

let stateDir: string;

function makeCtx(sessionId?: string): ToolContext {
    return {
        userId: 'u1',
        sessionId: sessionId ?? 's-current',
        workDir: stateDir,
        stateDir,
        systemInstruction: '',
    } as ToolContext;
}

async function writeSession(sessionId: string, messages: Array<{ role: string; content: string; timestamp: string }>) {
    const dir = join(stateDir, 'projects', sessionId);
    await fs.mkdir(dir, { recursive: true });
    const lines = messages.map((m, i) =>
        JSON.stringify({ id: i + 1, session_id: sessionId, ...m }),
    ).join('\n');
    await fs.writeFile(join(dir, `chat-${sessionId}.jsonl`), lines, 'utf8');
}

async function writeSessionsList(sessions: Array<{ id: string; start_time: string }>) {
    const dir = join(stateDir, 'projects');
    await fs.mkdir(dir, { recursive: true });
    const obj = { sessions: Object.fromEntries(sessions.map(s => [s.id, s])) };
    await fs.writeFile(join(dir, 'chat-sessions.json'), JSON.stringify(obj), 'utf8');
}

beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'gch-'));
});

afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
});

describe('get_chat_history tool', () => {
    it('scope=current returns messages of the active session', async () => {
        await writeSession('s-current', [
            { role: 'user', content: 'hi', timestamp: '2026-04-27T10:00:00Z' },
            { role: 'assistant', content: 'hello', timestamp: '2026-04-27T10:00:05Z' },
        ]);
        const out = await getChatHistoryTool.handler({}, stateDir, makeCtx());
        expect(out).toContain('当前会话');
        expect(out).toContain('hi');
        expect(out).toContain('hello');
    });

    it('scope=current without sessionId returns an error', async () => {
        const out = await getChatHistoryTool.handler({}, stateDir, {
            userId: 'u1', sessionId: '', workDir: stateDir, stateDir, systemInstruction: '',
        } as ToolContext);
        expect(out).toContain('[Error]');
    });

    it('scope=session reads a different session by id', async () => {
        await writeSession('other', [
            { role: 'user', content: 'from-other', timestamp: '2026-04-27T11:00:00Z' },
        ]);
        const out = await getChatHistoryTool.handler(
            { scope: 'session', session_id: 'other' }, stateDir, makeCtx(),
        );
        expect(out).toContain('from-other');
    });

    it('scope=session without session_id returns an error', async () => {
        const out = await getChatHistoryTool.handler({ scope: 'session' }, stateDir, makeCtx());
        expect(out).toContain('[Error]');
    });

    it('scope=session returns 0-message message when file missing', async () => {
        const out = await getChatHistoryTool.handler(
            { scope: 'session', session_id: 'missing' }, stateDir, makeCtx(),
        );
        expect(out).toContain('共 0 条');
    });

    it('scope=date aggregates across sessions and filters by date prefix', async () => {
        await writeSessionsList([
            { id: 'a', start_time: '2026-04-27T00:00:00Z' },
            { id: 'b', start_time: '2026-04-27T00:00:00Z' },
        ]);
        await writeSession('a', [
            { role: 'user', content: 'A-today', timestamp: '2026-04-27T09:00:00Z' },
            { role: 'user', content: 'A-yesterday', timestamp: '2026-04-26T09:00:00Z' },
        ]);
        await writeSession('b', [
            { role: 'user', content: 'B-today', timestamp: '2026-04-27T08:00:00Z' },
        ]);
        const out = await getChatHistoryTool.handler(
            { scope: 'date', date: '2026-04-27' }, stateDir, makeCtx(),
        );
        expect(out).toContain('A-today');
        expect(out).toContain('B-today');
        expect(out).not.toContain('A-yesterday');
        expect(out).toContain('共 2 条');
    });

    it('rejects unknown scope', async () => {
        const out = await getChatHistoryTool.handler({ scope: 'nope' }, stateDir, makeCtx());
        expect(out).toContain('[Error]');
        expect(out).toContain('未知 scope');
    });
});
