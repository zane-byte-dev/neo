import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { nbCreate, nbImportSource, nbGetSourceEntry, waitForNotebookIndexIdle } from '../notebook-service.js';

// Shared mock generate function that can be swapped per test
const _mockGenerate = vi.fn();

vi.mock('../../llm/client.js', () => ({
    LLMClient: class {
        generate(...args: any[]) { return _mockGenerate(...args); }
    },
}));

const { generateSourceGuide, generateAndSaveSourceGuide, generateNotebookOverview, generateMindMap, generateReport, generateAudioScript, runNoteQuickAction } = await import('../notebook-ai.js');

let workDir: string;

function mockGenerate(response: string) {
    _mockGenerate.mockResolvedValue(response);
}

beforeEach(async () => {
    workDir = join(tmpdir(), `neo-test-ai-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(workDir, { recursive: true });
});

afterEach(async () => {
    await waitForNotebookIndexIdle();
    await fs.rm(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('generateSourceGuide', () => {
    it('parses valid JSON response into SourceGuide', async () => {
        mockGenerate(JSON.stringify({
            summary: '这是一份关于 TypeScript 的文档',
            keyTopics: ['类型系统', '泛型', '装饰器'],
            suggestedQuestions: ['TypeScript 如何做类型推断？'],
        }));

        const guide = await generateSourceGuide({
            id: 'notebooks/test/sources/s1.md',
            title: 'TS Guide',
            content: 'TypeScript is a typed superset of JavaScript.',
        } as any);

        expect(guide.summary).toBe('这是一份关于 TypeScript 的文档');
        expect(guide.keyTopics).toHaveLength(3);
        expect(guide.suggestedQuestions).toHaveLength(1);
        expect(guide.generatedAt).toBeTypeOf('number');
    });

    it('handles malformed JSON gracefully with fallback', async () => {
        mockGenerate('not json at all');

        const guide = await generateSourceGuide({
            id: 'notebooks/test/sources/s1.md',
            title: 'Bad',
            content: 'Some content',
            summary: 'Existing summary',
        } as any);

        expect(guide.summary).toBeTruthy();
        expect(guide.keyTopics).toEqual([]);
        expect(guide.suggestedQuestions).toEqual([]);
    });

    it('handles null LLM response', async () => {
        mockGenerate(null as any);

        const guide = await generateSourceGuide({
            id: 'notebooks/test/sources/s1.md',
            title: 'Null',
            content: 'Content',
        } as any);

        expect(guide.summary).toBe('暂无摘要。');
    });
});

describe('generateAndSaveSourceGuide', () => {
    it('generates guide and persists it', async () => {
        mockGenerate(JSON.stringify({
            summary: '持久化测试摘要',
            keyTopics: ['测试'],
            suggestedQuestions: ['问题?'],
        }));

        const imported = nbImportSource(workDir, 'test-nb', {
            title: 'Persist Test',
            content: 'Some source content for testing persistence',
            type: 'text',
        });

        const entry = nbGetSourceEntry(workDir, 'test-nb', imported.id);
        expect(entry).toBeDefined();

        const guide = await generateAndSaveSourceGuide(workDir, 'test-nb', entry!, 'gemma');
        expect(guide.summary).toBe('持久化测试摘要');
    });
});

describe('generateNotebookOverview', () => {
    it('returns overview text from sources', async () => {
        mockGenerate('这些来源覆盖了前端开发的主要议题。');

        nbImportSource(workDir, 'ov-nb', { title: 'React', content: 'React is a library.', type: 'text' });
        nbImportSource(workDir, 'ov-nb', { title: 'Vue', content: 'Vue is a framework.', type: 'text' });

        const overview = await generateNotebookOverview(workDir, 'ov-nb');
        expect(overview).toBe('这些来源覆盖了前端开发的主要议题。');
    });

    it('returns empty string when no sources', async () => {
        const overview = await generateNotebookOverview(workDir, 'empty-nb');
        expect(overview).toBe('');
    });
});

describe('generateMindMap', () => {
    it('generates and saves mindmap artifact', async () => {
        mockGenerate('# 主题\n## 子主题1\n## 子主题2');

        nbImportSource(workDir, 'mm-nb', { title: 'Source', content: 'Content for mindmap.', type: 'text' });

        const artifact = await generateMindMap(workDir, 'mm-nb', undefined, '测试主题');
        expect(artifact.type).toBe('mindmap');
        expect(artifact.title).toContain('测试主题');
        expect(artifact.data.markdown).toContain('# 主题');
    });
});

describe('generateReport', () => {
    it('generates FAQ report', async () => {
        mockGenerate('### 问题1\n答案1\n\n### 问题2\n答案2');

        nbImportSource(workDir, 'rpt-nb', { title: 'FAQ Source', content: 'Content.', type: 'text' });

        const artifact = await generateReport(workDir, 'rpt-nb', 'faq');
        expect(artifact.type).toBe('report');
        expect(artifact.subtype).toBe('faq');
        expect(artifact.data.markdown).toContain('问题1');
    });

    it('generates custom report with custom prompt', async () => {
        mockGenerate('自定义报告内容');

        nbImportSource(workDir, 'custom-nb', { title: 'Custom', content: 'Data.', type: 'text' });

        const artifact = await generateReport(workDir, 'custom-nb', 'custom', {
            customPrompt: '请生成一份安全审计报告',
            title: '安全审计',
        });
        expect(artifact.title).toBe('安全审计');
    });

    it('handles all report types', async () => {
        for (const type of ['faq', 'study-guide', 'briefing', 'timeline', 'outline'] as const) {
            mockGenerate(`${type} content`);
            nbImportSource(workDir, `rpt-${type}`, { title: 'S', content: 'C', type: 'text' });
            const a = await generateReport(workDir, `rpt-${type}`, type);
            expect(a.type).toBe('report');
            expect(a.subtype).toBe(type);
        }
    });
});

describe('generateAudioScript', () => {
    it('generates audio artifact with parsed segments', async () => {
        mockGenerate(JSON.stringify([
            { speaker: 'A', text: '欢迎来到节目' },
            { speaker: 'B', text: '今天我们讨论AI' },
            { speaker: 'A', text: '感谢收听' },
        ]));

        nbImportSource(workDir, 'audio-nb', { title: 'Audio Src', content: 'AI content.', type: 'text' });

        const artifact = await generateAudioScript(workDir, 'audio-nb');
        expect(artifact.type).toBe('audio');
        expect(artifact.data.segments).toHaveLength(3);
        expect(artifact.data.segments[0].speaker).toBe('A');
    });

    it('falls back to raw text on malformed JSON', async () => {
        mockGenerate('This is not JSON but raw text');

        nbImportSource(workDir, 'audio-bad', { title: 'Bad Audio', content: 'Stuff.', type: 'text' });

        const artifact = await generateAudioScript(workDir, 'audio-bad');
        expect(artifact.type).toBe('audio');
        expect(artifact.data.segments.length).toBeGreaterThan(0);
    });
});

describe('runNoteQuickAction', () => {
    it('merge action returns combined text', async () => {
        mockGenerate('合并后的笔记内容');

        const result = await runNoteQuickAction('merge', [
            { title: '笔记1', content: '内容1' },
            { title: '笔记2', content: '内容2' },
        ]);
        expect(result).toBe('合并后的笔记内容');
    });

    it('returns empty string for empty notes', async () => {
        const result = await runNoteQuickAction('outline', []);
        expect(result).toBe('');
    });

    it('supports all action types', async () => {
        for (const action of ['merge', 'outline', 'feedback', 'study-guide'] as const) {
            mockGenerate(`${action} result`);
            const result = await runNoteQuickAction(action, [{ title: 'Test', content: 'Content' }]);
            expect(result).toBe(`${action} result`);
        }
    });
});
