/**
 * Batch unit tests for internal tools that previously had 0% coverage.
 * Covers happy-path + error cases for each tool's `handler`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDatetimeTool } from '../get-datetime.js';
import { enter_plan_mode, exit_plan_mode } from '../plan-mode.js';
import { globTool } from '../glob.js';
import { grepTool } from '../grep.js';
import { editFileTool } from '../edit-file.js';
import { todoTool } from '../todo.js';
import { saveMemoryTool } from '../save-memory.js';
import type { ToolContext } from '../../../llm/types.js';

let tmp: string;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tools-batch-'));
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

function ctx(extra: Partial<ToolContext> = {}): ToolContext {
    return {
        userId: 'u1',
        sessionId: 's1',
        workDir: tmp,
        stateDir: tmp,
        systemInstruction: '',
        ...extra,
    };
}

// ───────────────────────────────────────────────────────────── get_datetime ──

describe('get_datetime', () => {
    it('returns a full string by default', async () => {
        const out = await getDatetimeTool.handler({}, tmp);
        expect(out).toMatch(/\d{4}/); // year somewhere
    });

    it('returns date only when format=date', async () => {
        const out = await getDatetimeTool.handler({ format: 'date' }, tmp);
        expect(out).toMatch(/年|\d{4}/);
    });

    it('returns time only when format=time', async () => {
        const out = await getDatetimeTool.handler({ format: 'time' }, tmp);
        expect(out).toMatch(/\d{2}/);
    });

    it('returns numeric timestamp when format=timestamp', async () => {
        const out = await getDatetimeTool.handler({ format: 'timestamp' }, tmp);
        expect(out).toMatch(/^\d{10,}$/);
    });

    it('respects timezone parameter', async () => {
        const out = await getDatetimeTool.handler({ timezone: 'UTC' }, tmp);
        expect(out).toContain('UTC');
    });

    it('returns error message for invalid timezone', async () => {
        const out = await getDatetimeTool.handler({ timezone: 'Not/AReal_Zone' }, tmp);
        expect(out).toContain('[Error]');
    });
});

// ──────────────────────────────────────────────────────────────── plan_mode ──

describe('plan-mode tools', () => {
    it('enter_plan_mode flips ctx.mode to plan', async () => {
        const c = ctx();
        const out = await enter_plan_mode.handler({ goal: 'investigate bug' }, tmp, c);
        expect(out).toContain('Plan mode activated');
        expect(c.mode).toBe('plan');
    });

    it('enter_plan_mode requires goal', async () => {
        const out = await enter_plan_mode.handler({}, tmp, ctx());
        expect(out).toContain('[Error]');
    });

    it('exit_plan_mode flips ctx.mode back to normal', async () => {
        const c = ctx({ mode: 'plan' });
        const out = await exit_plan_mode.handler({ plan: 'do X then Y' }, tmp, c);
        expect(out).toContain('Exited plan mode');
        expect(c.mode).toBe('normal');
    });

    it('exit_plan_mode requires plan', async () => {
        const out = await exit_plan_mode.handler({}, tmp, ctx());
        expect(out).toContain('[Error]');
    });
});

// ───────────────────────────────────────────────────────────────────── glob ──

describe('glob tool', () => {
    it('finds files matching simple pattern', async () => {
        await fs.writeFile(join(tmp, 'a.ts'), '');
        await fs.writeFile(join(tmp, 'b.ts'), '');
        await fs.writeFile(join(tmp, 'c.md'), '');
        const out = await globTool.handler({ pattern: '*.ts' }, tmp);
        expect(out).toContain('a.ts');
        expect(out).toContain('b.ts');
        expect(out).not.toContain('c.md');
    });

    it('returns no-match message for non-matching pattern', async () => {
        await fs.writeFile(join(tmp, 'a.ts'), '');
        const out = await globTool.handler({ pattern: '*.nonexistent' }, tmp);
        expect(out).toContain('No files matching');
    });

    it('rejects empty pattern', async () => {
        const out = await globTool.handler({ pattern: '' }, tmp);
        expect(out).toContain('[Error]');
    });

    it('reports error when path does not exist', async () => {
        const out = await globTool.handler({ pattern: '*.ts', path: 'no-such-dir' }, tmp);
        expect(out).toContain('[Error]');
    });
});

// ───────────────────────────────────────────────────────────────────── grep ──

describe('grep tool', () => {
    beforeEach(async () => {
        await fs.writeFile(join(tmp, 'a.ts'), 'TODO: fix this\nconst x = 1;\n');
        await fs.writeFile(join(tmp, 'b.ts'), 'no match here\n');
        await fs.writeFile(join(tmp, 'c.md'), 'TODO: doc\n');
    });

    it('finds files matching regex (default mode = files)', async () => {
        const out = await grepTool.handler({ pattern: 'TODO' }, tmp);
        expect(out).toContain('a.ts');
        expect(out).toContain('c.md');
        expect(out).not.toContain('b.ts');
    });

    it('respects glob filter', async () => {
        const out = await grepTool.handler({ pattern: 'TODO', glob: '*.md' }, tmp);
        expect(out).toContain('c.md');
        expect(out).not.toContain('a.ts');
    });

    it('content mode shows matching lines', async () => {
        const out = await grepTool.handler({ pattern: 'TODO', output_mode: 'content' }, tmp);
        expect(out).toMatch(/> .*TODO/);
    });

    it('count mode shows match counts', async () => {
        const out = await grepTool.handler({ pattern: 'TODO', output_mode: 'count' }, tmp);
        expect(out).toMatch(/a\.ts: 1/);
    });

    it('returns no-match message when nothing matches', async () => {
        const out = await grepTool.handler({ pattern: 'ZZZ_NOPE_ZZZ' }, tmp);
        expect(out).toContain('No matches');
    });

    it('rejects invalid regex', async () => {
        const out = await grepTool.handler({ pattern: '(' }, tmp);
        expect(out).toContain('[Error] Invalid regex');
    });

    it('rejects empty pattern', async () => {
        const out = await grepTool.handler({ pattern: '' }, tmp);
        expect(out).toContain('[Error]');
    });

    it('case-insensitive search', async () => {
        const out = await grepTool.handler({ pattern: 'todo', case_sensitive: 'false' }, tmp);
        expect(out).toContain('a.ts');
    });
});

// ──────────────────────────────────────────────────────────────── edit_file ──

describe('edit_file tool', () => {
    it('replaces a unique substring in a file', async () => {
        const f = join(tmp, 'note.txt');
        await fs.writeFile(f, 'hello world');
        const out = await editFileTool.handler({ path: 'note.txt', old_str: 'world', new_str: 'there' }, tmp);
        expect(out).toContain('OK: edited');
        expect(await fs.readFile(f, 'utf8')).toBe('hello there');
    });

    it('appends when old_str is empty and file exists', async () => {
        const f = join(tmp, 'log.txt');
        await fs.writeFile(f, 'line1');
        const out = await editFileTool.handler({ path: 'log.txt', old_str: '', new_str: '\nline2' }, tmp);
        expect(out).toContain('appended');
        expect(await fs.readFile(f, 'utf8')).toBe('line1\nline2');
    });

    it('creates a new file when old_str is empty and file missing', async () => {
        const out = await editFileTool.handler(
            { path: 'sub/new.txt', old_str: '', new_str: 'fresh' },
            tmp,
        );
        expect(out).toContain('created');
        expect(await fs.readFile(join(tmp, 'sub/new.txt'), 'utf8')).toBe('fresh');
    });

    it('errors when old_str not found', async () => {
        const f = join(tmp, 'a.txt');
        await fs.writeFile(f, 'abc');
        const out = await editFileTool.handler({ path: 'a.txt', old_str: 'xyz', new_str: '!' }, tmp);
        expect(out).toContain('not found');
    });

    it('errors when old_str matches multiple times', async () => {
        const f = join(tmp, 'a.txt');
        await fs.writeFile(f, 'foo foo foo');
        const out = await editFileTool.handler({ path: 'a.txt', old_str: 'foo', new_str: 'bar' }, tmp);
        expect(out).toMatch(/matches \d+ locations/);
    });

    it('blocks path traversal', async () => {
        await expect(
            editFileTool.handler({ path: '../escape.txt', old_str: '', new_str: 'x' }, tmp),
        ).rejects.toThrow(/Path traversal/);
    });

    it('blocks absolute sibling-prefix paths', async () => {
        const sibling = `${tmp}-sibling`;
        await fs.mkdir(sibling, { recursive: true });
        try {
            await expect(
                editFileTool.handler({ path: join(sibling, 'escape.txt'), old_str: '', new_str: 'x' }, tmp),
            ).rejects.toThrow(/Path traversal/);
        } finally {
            rmSync(sibling, { recursive: true, force: true });
        }
    });

    it('errors when path is empty', async () => {
        const out = await editFileTool.handler({ path: '', old_str: 'a', new_str: 'b' }, tmp);
        expect(out).toContain('[Error]');
    });
});

// ───────────────────────────────────────────────────────────────────── todo ──

describe('todo tool', () => {
    it('list returns empty placeholder when no todos exist', async () => {
        const out = await todoTool.handler({ action: 'list' }, tmp, ctx());
        expect(out).toContain('没有待办');
    });

    it('add → list → update → list session todos', async () => {
        const c = ctx();
        const add = await todoTool.handler({ action: 'add', title: 'first task' }, tmp, c);
        expect(add).toContain('first task');

        const list1 = await todoTool.handler({ action: 'list' }, tmp, c);
        expect(list1).toContain('first task');
        expect(list1).toContain('not-started');

        const upd = await todoTool.handler(
            { action: 'update', id: 1, status: 'completed' },
            tmp, c,
        );
        expect(upd).toContain('completed');

        const list2 = await todoTool.handler({ action: 'list' }, tmp, c);
        expect(list2).toContain('completed');
    });

    it('write replaces the entire list', async () => {
        const items = JSON.stringify([
            { id: 1, title: 'a', status: 'not-started' },
            { id: 2, title: 'b', status: 'in-progress' },
        ]);
        const out = await todoTool.handler({ action: 'write', items }, tmp, ctx());
        expect(out).toContain('Todo 列表已更新');
        expect(out).toContain('a');
        expect(out).toContain('b');
    });

    it('write rejects non-JSON-array items', async () => {
        const out = await todoTool.handler({ action: 'write', items: 'not json' }, tmp, ctx());
        expect(out).toContain('[Error]');
    });

    it('persistent scope writes to memory/tasks.json', async () => {
        await todoTool.handler({ action: 'add', title: 'persistent', scope: 'persistent' }, tmp, ctx());
        const raw = await fs.readFile(join(tmp, 'memory', 'tasks.json'), 'utf8');
        expect(raw).toContain('persistent');
    });

    it('errors when sessionId is missing from context', async () => {
        const out = await todoTool.handler({ action: 'list' }, tmp, undefined);
        expect(out).toContain('[Error]');
    });

    it('update needs both id and status', async () => {
        const c = ctx();
        const noId = await todoTool.handler({ action: 'update', status: 'completed' }, tmp, c);
        expect(noId).toContain('[Error]');
        const noStatus = await todoTool.handler({ action: 'update', id: 1 }, tmp, c);
        expect(noStatus).toContain('[Error]');
    });

    it('add requires title', async () => {
        const out = await todoTool.handler({ action: 'add' }, tmp, ctx());
        expect(out).toContain('[Error]');
    });

    it('rejects unknown action', async () => {
        const out = await todoTool.handler({ action: 'wat' }, tmp, ctx());
        expect(out).toContain('[Error]');
    });
});

// ───────────────────────────────────────────────────────────── save_memory ──

describe('save_memory tool', () => {
    it('append creates the file and writes content', async () => {
        const out = await saveMemoryTool.handler(
            { action: 'append', file: 'facts.md', content: 'first fact' },
            tmp, ctx(),
        );
        expect(out).toContain('已追加');
        const body = await fs.readFile(join(tmp, 'memory', 'facts.md'), 'utf8');
        expect(body).toContain('first fact');
    });

    it('append twice preserves both entries', async () => {
        const c = ctx();
        await saveMemoryTool.handler({ action: 'append', file: 'f.md', content: 'one' }, tmp, c);
        await saveMemoryTool.handler({ action: 'append', file: 'f.md', content: 'two' }, tmp, c);
        const body = await fs.readFile(join(tmp, 'memory', 'f.md'), 'utf8');
        expect(body).toContain('one');
        expect(body).toContain('two');
    });

    it('write overwrites existing content', async () => {
        const c = ctx();
        await saveMemoryTool.handler({ action: 'append', file: 'f.md', content: 'old' }, tmp, c);
        await saveMemoryTool.handler({ action: 'write', file: 'f.md', content: 'new' }, tmp, c);
        const body = await fs.readFile(join(tmp, 'memory', 'f.md'), 'utf8');
        expect(body).toBe('new');
    });

    it('read returns previously written content', async () => {
        const c = ctx();
        await saveMemoryTool.handler({ action: 'write', file: 'a.md', content: 'hello' }, tmp, c);
        const out = await saveMemoryTool.handler({ action: 'read', file: 'a.md' }, tmp, c);
        expect(out).toContain('hello');
    });

    it('read of missing file returns error', async () => {
        const out = await saveMemoryTool.handler({ action: 'read', file: 'missing.md' }, tmp, ctx());
        expect(out).toContain('[Error]');
    });

    it('list shows files written via append', async () => {
        const c = ctx();
        await saveMemoryTool.handler({ action: 'write', file: 'a.md', content: 'x' }, tmp, c);
        await saveMemoryTool.handler({ action: 'write', file: 'sub/b.md', content: 'y' }, tmp, c);
        const out = await saveMemoryTool.handler({ action: 'list' }, tmp, c);
        expect(out).toContain('a.md');
        expect(out).toContain('sub');
    });

    it('list of empty memory dir returns placeholder', async () => {
        const out = await saveMemoryTool.handler({ action: 'list' }, tmp, ctx());
        expect(out).toContain('memory/');
    });

    it('blocks path traversal', async () => {
        const out = await saveMemoryTool.handler(
            { action: 'write', file: '../escape.md', content: 'pwn' },
            tmp, ctx(),
        );
        expect(out).toContain('[Error]');
    });

    it('blocks sibling-prefix memory paths', async () => {
        const out = await saveMemoryTool.handler(
            { action: 'write', file: '../memory-sibling/escape.md', content: 'pwn' },
            tmp, ctx(),
        );
        expect(out).toContain('[Error]');
    });

    it('append requires file and content', async () => {
        const noFile = await saveMemoryTool.handler({ action: 'append', content: 'x' }, tmp, ctx());
        expect(noFile).toContain('[Error]');
        const noContent = await saveMemoryTool.handler({ action: 'append', file: 'a.md' }, tmp, ctx());
        expect(noContent).toContain('[Error]');
    });
});
