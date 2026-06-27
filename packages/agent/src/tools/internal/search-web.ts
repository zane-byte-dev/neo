import type { Tool } from '../_base.js';
import { withRetry } from '../../utils/retry.js';
import { log } from '../../utils/logger.js';

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
    meta: { category: 'web', version: '1.2.0', permission: 'read' },
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

        // Try SearXNG first
        const searxngResult = await searchViaSearxng(query, maxResults);
        if (searxngResult) return searxngResult;

        // Fallback to DuckDuckGo Lite
        const ddgResult = await searchViaDuckDuckGo(query, maxResults);
        if (ddgResult) return ddgResult;

        return `[Error] 所有搜索引擎均不可用。SearXNG (${SEARXNG_BASE_URL}) 和 DuckDuckGo Lite 均失败。`;
    },
};

async function searchViaSearxng(query: string, maxResults: number): Promise<string | null> {
    try {
        const searxngRes = await withRetry(async () => {
            const r = await fetch(
                `${SEARXNG_BASE_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general`,
                {
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(12_000),
                },
            );
            if (!r.ok) {
                const err: Error & { status?: number } = new Error(`HTTP ${r.status}`);
                err.status = r.status;
                throw err;
            }
            return r;
        }, {
            retries: 1,
            baseMs: 300,
            isRetryable: (err) => {
                const e = err as { status?: number };
                if (typeof e?.status === 'number') return e.status >= 500 || e.status === 429;
                return true;
            },
            onRetry: (err, attempt, delayMs) =>
                log.warn('search_web', `searxng retry #${attempt} in ${delayMs}ms`, {
                    error: err instanceof Error ? err.message : String(err),
                }),
        });

        const data = (await searxngRes.json()) as SearxngResponse;
        const results = normalizeSearxngResults(data, maxResults);

        if (results.length === 0) {
            return `[Info] "${query}" 暂无搜索结果（SearXNG: ${SEARXNG_BASE_URL}），请换个关键词或使用 fetch_url 直接访问目标网址。`;
        }

        return formatSearchResults(query, results);
    } catch {
        return null; // fall through to next engine
    }
}

async function searchViaDuckDuckGo(query: string, maxResults: number): Promise<string | null> {
    try {
        const res = await fetch(
            `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Neo/2.0)',
                    'Accept': 'text/html',
                },
                signal: AbortSignal.timeout(15_000),
            },
        );
        if (!res.ok) return null;

        const html = await res.text();
        const results: SearchResult[] = [];

        // Parse DuckDuckGo Lite HTML results.
        // DDG Lite now wraps real URLs in redirect: //duckduckgo.com/l/?uddg=<encoded_url>&rut=...
        // Snippet td uses single-quoted class attribute.
        const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
        const snippetRegex = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;

        const links: { url: string; title: string }[] = [];
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(html)) !== null) {
            const rawHref = decodeHtmlEntities(match[1].trim());
            const title = decodeHtmlEntities(stripHtml(match[2].trim()));
            // Extract real URL from DDG redirect parameter
            const uddgMatch = /[?&]uddg=([^&]+)/.exec(rawHref);
            let url: string;
            if (uddgMatch) {
                url = decodeURIComponent(uddgMatch[1]);
            } else {
                url = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
            }
            if (url.startsWith('http://') || url.startsWith('https://')) {
                links.push({ url, title });
            }
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(decodeHtmlEntities(stripHtml(match[1].trim())));
        }

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
            results.push({
                title: links[i].title || links[i].url,
                url: links[i].url,
                snippet: snippets[i] ?? '',
            });
        }

        if (results.length === 0) {
            return `[Info] "${query}" 暂无搜索结果（DuckDuckGo），请换个关键词或使用 fetch_url 直接访问目标网址。`;
        }

        return formatSearchResults(query, results, 'DuckDuckGo');
    } catch {
        return null;
    }
}

function formatSearchResults(query: string, results: SearchResult[], engine?: string): string {
    const lines = results.map((r, i) => {
        const snippetLine = r.snippet ? `\n   ${r.snippet}` : '';
        return `${i + 1}. **${r.title}**${snippetLine}\n   ${r.url}`;
    });
    const suffix = engine ? ` (via ${engine})` : '';
    return `🔍 "${query}" 搜索结果${suffix}:\n\n${lines.join('\n\n')}`;
}
