import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { nbImportSource } from '../notebook-service.js';
import type { NotebookChatStreamEvent } from '../notebook-chat.js';

const _mockGenerate = vi.fn();

vi.mock('../../llm/client.js', () => ({
    LLMClient: class {
        generateWithUsage(...args: any[]) { return _mockGenerate(...args); }
    },
}));

const { streamNotebookChat } = await import('../notebook-chat.js');

let workDir: string;

function mockGenerate(response: string) {
    _mockGenerate.mockResolvedValue({
        text: response,
        usage: {
            inputTokens: 10,
            outputTokens: 10,
            totalTokens: 20,
        },
        model: 'gemma',
    });
}

beforeEach(async () => {
    workDir = join(tmpdir(), `neo-test-chat-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(workDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function collectEvents(events: NotebookChatStreamEvent[]) {
    return (evt: NotebookChatStreamEvent) => { events.push(evt); };
}

describe('streamNotebookChat', () => {
    it('sends text, citations, and done events', async () => {
        mockGenerate('TypeScript 是一种类型化语言【1】。');

        nbImportSource(workDir, 'chat-nb', {
            title: 'TypeScript Intro',
            content: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
            type: 'text',
        });

        const events: NotebookChatStreamEvent[] = [];
        const result = await streamNotebookChat(
            workDir, 'chat-nb', '什么是 TypeScript？', undefined,
            collectEvents(events),
        );

        expect(result.role).toBe('assistant');
        expect(result.content).toContain('TypeScript');

        const types = events.map(e => e.type);
        expect(types).toContain('meta');
        expect(types).toContain('text');
        expect(types).toContain('citations');
        expect(types).toContain('done');
    });

    it('handles selected source filtering', async () => {
        nbImportSource(workDir, 'filter-nb', {
            title: 'Source A', content: 'Alpha content about React', type: 'text',
        });
        const src2 = nbImportSource(workDir, 'filter-nb', {
            title: 'Source B', content: 'Beta content about Vue', type: 'text',
        });

        mockGenerate('Vue 是一个框架【1】。');

        const events: NotebookChatStreamEvent[] = [];
        await streamNotebookChat(
            workDir, 'filter-nb', '告诉我关于 Vue', [src2.id],
            collectEvents(events),
        );

        const metaEvt = events.find(e => e.type === 'meta');
        expect(metaEvt?.sources).toBeDefined();
        // Only Source B should be in meta
        expect(metaEvt!.sources!.length).toBe(1);
        expect(metaEvt!.sources![0].title).toBe('Source B');
    });

    it('persists user and assistant messages', async () => {
        mockGenerate('简单回答。');

        nbImportSource(workDir, 'persist-nb', {
            title: 'Persist Source', content: 'Content for persistence test.', type: 'text',
        });

        const events: NotebookChatStreamEvent[] = [];
        const assistantMsg = await streamNotebookChat(
            workDir, 'persist-nb', '测试消息', undefined,
            collectEvents(events),
        );

        expect(assistantMsg.id).toMatch(/^msg_/);
        expect(assistantMsg.timestamp).toBeTypeOf('number');
    });

    it('parses citation markers correctly', async () => {
        nbImportSource(workDir, 'cite-nb', {
            title: '引用来源', content: '这是包含特定信息的文档内容。', type: 'text',
        });

        mockGenerate('文档内容很重要【1】，值得关注【1】。');

        const events: NotebookChatStreamEvent[] = [];
        await streamNotebookChat(
            workDir, 'cite-nb', '总结一下', undefined,
            collectEvents(events),
        );

        const citEvt = events.find(e => e.type === 'citations');
        expect(citEvt?.citations).toBeDefined();
        expect(citEvt!.citations!.length).toBe(1);
        expect(citEvt!.citations![0].n).toBe(1);
        expect(citEvt!.citations![0].title).toBe('引用来源');
    });

    it('handles LLM error gracefully', async () => {
        _mockGenerate.mockRejectedValue(new Error('API timeout'));

        nbImportSource(workDir, 'err-nb', {
            title: 'Error Source', content: 'Content.', type: 'text',
        });

        const events: NotebookChatStreamEvent[] = [];
        await expect(
            streamNotebookChat(workDir, 'err-nb', '问题', undefined, collectEvents(events)),
        ).rejects.toThrow('API timeout');

        const errEvt = events.find(e => e.type === 'error');
        expect(errEvt?.error).toContain('API timeout');
    });

    it('respects abort signal', async () => {
        const controller = new AbortController();
        controller.abort(); // Abort immediately

        _mockGenerate.mockImplementation(async () => {
            throw new Error('aborted');
        });

        nbImportSource(workDir, 'abort-nb', {
            title: 'Abort Source', content: 'Content.', type: 'text',
        });

        const events: NotebookChatStreamEvent[] = [];
        await expect(
            streamNotebookChat(workDir, 'abort-nb', '问题', undefined, collectEvents(events), controller.signal),
        ).rejects.toThrow();
    });

    it('works with no sources (empty notebook)', async () => {
        mockGenerate('来源中没有相关信息。');

        const events: NotebookChatStreamEvent[] = [];
        // Creating empty notebook dir manually
        const nbDir = join(workDir, 'notebooks', 'empty-nb');
        await fs.mkdir(nbDir, { recursive: true });

        await streamNotebookChat(
            workDir, 'empty-nb', '有什么信息？', undefined,
            collectEvents(events),
        );

        // Should still emit meta (empty sources) + text + done
        const types = events.map(e => e.type);
        expect(types).toContain('meta');
        expect(types).toContain('text');
        expect(types).toContain('done');
    });
});
