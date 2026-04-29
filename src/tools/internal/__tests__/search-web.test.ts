import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchWebTool } from '../search-web.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('search_web tool', () => {
    it('formats SearXNG JSON results', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
            results: [
                { title: '<b>Hello</b>', url: 'https://example.com/a', content: 'Snippet&nbsp;A' },
                { title: 'Two', url: 'https://example.com/b', content: 'snippet B' },
                { title: 'bad', url: 'ftp://nope', content: '' },
            ],
        }), { status: 200 }));

        const out = await searchWebTool.handler({ query: 'hello', max_results: 5 }, '/tmp');
        expect(out).toContain('"hello"');
        expect(out).toContain('Hello');
        expect(out).toContain('https://example.com/a');
        expect(out).toContain('https://example.com/b');
        expect(out).not.toContain('ftp://nope');
    });

    it('returns "暂无搜索结果" when SearXNG returns empty', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(JSON.stringify({ results: [] }), { status: 200 }),
        );
        const out = await searchWebTool.handler({ query: 'zzz' }, '/tmp');
        expect(out).toContain('暂无搜索结果');
    });

    it('falls back to DuckDuckGo when SearXNG fails', async () => {
        const ddgHtml = `
            <html><body>
            <a rel="nofollow" href="https://ddg.example/x">DDG Title</a>
            <td class="result-snippet">DDG snippet</td>
            </body></html>`;
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('boom', { status: 500 })) // searxng fail
            .mockResolvedValueOnce(new Response('boom', { status: 500 })) // searxng retry fail
            .mockResolvedValueOnce(new Response(ddgHtml, { status: 200 })); // ddg success

        const out = await searchWebTool.handler({ query: 'fallback' }, '/tmp');
        expect(fetchMock).toHaveBeenCalled();
        expect(out).toContain('DDG Title');
        expect(out).toContain('https://ddg.example/x');
        expect(out).toContain('DuckDuckGo');
    });

    it('returns the global error message when both engines fail', async () => {
        // searxng + retry both fail, ddg rejects (network error)
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
        const out = await searchWebTool.handler({ query: 'broken' }, '/tmp');
        expect(out).toContain('[Error]');
        expect(out).toContain('搜索引擎均不可用');
    });

    it('caps max_results at 10', async () => {
        const many = Array.from({ length: 30 }, (_, i) => ({
            title: `T${i}`, url: `https://x.com/${i}`, content: 's',
        }));
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(JSON.stringify({ results: many }), { status: 200 }),
        );
        const out = await searchWebTool.handler({ query: 'q', max_results: 999 }, '/tmp');
        // only 10 of the 30 should be rendered
        expect(out).toContain('T0');
        expect(out).toContain('T9');
        expect(out).not.toContain('T10');
    });
});
