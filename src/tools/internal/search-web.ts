import type { Tool } from '../_base.js';

const SEARXNG_BASE_URL = process.env.SEARXNG_BASE_URL ?? 'http://127.0.0.1:8080';

function stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/');
}

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

interface SearxngResult {
    title?: string;
    url?: string;
    content?: string;
}

interface SearxngResponse {
    results?: SearxngResult[];
}

function normalizeSearxngResults(data: SearxngResponse, max: number): SearchResult[] {
    const raw = data.results ?? [];
    const normalized: SearchResult[] = [];

    for (const item of raw) {
        if (normalized.length >= max) break;
        const url = String(item.url ?? '').trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) continue;

        const title = decodeHtmlEntities(stripHtml(String(item.title ?? '').trim())) || url;
        const snippet = decodeHtmlEntities(stripHtml(String(item.content ?? '').trim()));
        normalized.push({ title, url, snippet });
    }

    return normalized;
}

export const searchWebTool: Tool = {
    meta: { category: 'web', version: '1.2.0' },
    declaration: {
        name: 'search_web',
        description:
            'Search the web via local SearXNG and return a list of results with titles, URLs, and snippets. ' +
            'Use this to find current information, news, documentation, or any topic.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' },
                max_results: {
                    type: 'number',
                    description: 'Maximum number of results to return (default 5, max 10)',
                },
            },
            required: ['query'],
        },
    },
    handler: async (args) => {
        const query = String(args.query ?? '');
        const maxResults = Math.min(Number(args.max_results ?? 5), 10);

        try {
            const searxngRes = await fetch(
                `${SEARXNG_BASE_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general`,
                {
                    headers: {
                        'Accept': 'application/json',
                    },
                    signal: AbortSignal.timeout(12_000),
                },
            );
            if (!searxngRes.ok) {
                return `[Error] SearXNG 搜索失败: HTTP ${searxngRes.status} (${SEARXNG_BASE_URL})`;
            }

            const data = (await searxngRes.json()) as SearxngResponse;
            const results = normalizeSearxngResults(data, maxResults);

            if (results.length === 0) {
                return `[Info] "${query}" 暂无搜索结果（SearXNG: ${SEARXNG_BASE_URL}），请换个关键词或使用 fetch_url 直接访问目标网址。`;
            }

            const lines = results.map((r, i) => {
                const snippetLine = r.snippet ? `\n   ${r.snippet}` : '';
                return `${i + 1}. **${r.title}**${snippetLine}\n   ${r.url}`;
            });
            return `🔍 "${query}" 搜索结果:\n\n${lines.join('\n\n')}`;
        } catch (err: unknown) {
            return `[Error] search_web (SearXNG ${SEARXNG_BASE_URL}): ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
