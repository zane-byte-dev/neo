import type { Tool } from '../_base.js';
import { withRetry } from '../../utils/retry.js';
import { log } from '../../utils/logger.js';

const htmlToText = (html: string): string =>
    html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const tryFetch = async (
    targetUrl: string,
    timeoutMs = 15_000,
): Promise<{ ok: boolean; text?: string; status?: number }> => {
    try {
        // Retry on transient network errors / 5xx. 4xx is not retried.
        return await withRetry(async () => {
            const res = await fetch(targetUrl, {
                signal: AbortSignal.timeout(timeoutMs),
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; inkClaw/2.0)' },
            });
            if (!res.ok) {
                const err: Error & { status?: number } = new Error(`HTTP ${res.status}`);
                err.status = res.status;
                throw err;
            }
            return { ok: true as const, text: htmlToText(await res.text()) };
        }, {
            retries: 2,
            baseMs: 400,
            isRetryable: (err) => {
                const e = err as { status?: number; name?: string };
                if (typeof e?.status === 'number') return e.status >= 500 || e.status === 429;
                return true; // network error / timeout
            },
            onRetry: (err, attempt, delayMs) => {
                log.warn('fetch_url', `retry #${attempt} in ${delayMs}ms`, {
                    url: targetUrl,
                    error: err instanceof Error ? err.message : String(err),
                });
            },
        });
    } catch (err) {
        const e = err as { status?: number };
        if (typeof e?.status === 'number') return { ok: false, status: e.status };
        return { ok: false };
    }
};

export const fetchUrlTool: Tool = {
    meta: { category: 'web', version: '1.0.0', permission: 'read' },
    declaration: {
        name: 'fetch_url',
        description:
            'Fetch a web page and return its readable plain text (HTML/scripts/styles stripped). ' +
            'Good for reading articles, documentation, GitHub READMEs, or any public URL.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)' },
                max_chars: {
                    type: 'number',
                    description: 'Maximum characters to return (default 8000, max 30000)',
                },
            },
            required: ['url'],
        },
    },
    handler: async (args) => {
        const url = String(args.url ?? '');
        const maxChars = Math.min(Number(args.max_chars ?? 8_000), 30_000);

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return '[Error] URL 必须以 http:// 或 https:// 开头';
        }

        const truncate = (text: string, prefix = '') => {
            const full = prefix + text;
            return full.length > maxChars
                ? full.slice(0, maxChars) + `\n\n[...已截断，还有 ${full.length - maxChars} 个字符]`
                : full;
        };

        try {
            const direct = await tryFetch(url);
            if (direct.ok && direct.text) return truncate(direct.text);

            const blocked = [401, 403, 429];
            if (!blocked.includes(direct.status ?? 0)) {
                return `[Error] HTTP ${direct.status ?? '网络错误'} — 无法访问该页面`;
            }

            const gc = await tryFetch(
                `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`,
                12_000,
            );
            if (gc.ok && gc.text) {
                return truncate(gc.text, `[来源: Google Cache — 原始页面返回 ${direct.status}]\n\n`);
            }

            const wb = await tryFetch(
                `https://web.archive.org/web/${encodeURIComponent(url)}`,
                15_000,
            );
            if (wb.ok && wb.text) {
                return truncate(wb.text, `[来源: Wayback Machine — 原始页面返回 ${direct.status}]\n\n`);
            }

            return (
                `[Error] HTTP ${direct.status} — 页面拒绝访问，` +
                `Google Cache 和 Wayback Machine 均无法获取内容。` +
                `\n请粘贴页面文字或截图，我再帮你分析。`
            );
        } catch (err: unknown) {
            return `[Error] fetch_url: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
