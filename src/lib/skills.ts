/**
 * skills.ts — Pluggable skill definitions for the GeminiClient agent runtime.
 *
 * Each skill adds a new tool that the LLM can call during its agentic loop.
 * Register skills before the first prompt is sent; they're merged into the
 * function-calling declarations sent to the Gemini API.
 *
 * Built-in skills:
 *   fetch_url      — Fetch a web page and return clean plain text
 *   search_web     — Search the web via DuckDuckGo
 *   get_weather    — Real-time weather via wttr.in (no API key needed)
 *   http_request   — Generic HTTP GET / POST to any API
 *   get_datetime   — Current date/time with optional timezone
 *   browser_fetch  — Fetch JS-rendered pages via real Chrome (Puppeteer)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { registerSkill, Skill, geminiGenerate } from './gemini-client.js';
import { browserFetch } from './browser-service.js';

// ── fetch_url ─────────────────────────────────────────────────────────────────

const fetchUrlSkill: Skill = {
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
                const res = await fetch(targetUrl, {
                    signal: AbortSignal.timeout(timeoutMs),
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; inkClaw/2.0)' },
                });
                if (!res.ok) return { ok: false, status: res.status };
                return { ok: true, text: htmlToText(await res.text()) };
            } catch {
                return { ok: false };
            }
        };

        const truncate = (text: string, prefix = '') => {
            const full = prefix + text;
            return full.length > maxChars
                ? full.slice(0, maxChars) + `\n\n[...已截断，还有 ${full.length - maxChars} 个字符]`
                : full;
        };

        try {
            // 1. Direct fetch
            const direct = await tryFetch(url);
            if (direct.ok && direct.text) return truncate(direct.text);

            // Only attempt fallbacks for access-denied responses
            const blocked = [401, 403, 429];
            if (!blocked.includes(direct.status ?? 0)) {
                return `[Error] HTTP ${direct.status ?? '网络错误'} — 无法访问该页面`;
            }

            // 2. Google Cache fallback
            const gc = await tryFetch(
                `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`,
                12_000,
            );
            if (gc.ok && gc.text) {
                return truncate(gc.text, `[来源: Google Cache — 原始页面返回 ${direct.status}]\n\n`);
            }

            // 3. Wayback Machine fallback
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

// ── search_web ────────────────────────────────────────────────────────────────

const searchWebSkill: Skill = {
    declaration: {
        name: 'search_web',
        description:
            'Search the web using DuckDuckGo and return a list of results with titles, URLs, and snippets. ' +
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
            // 1. Instant Answer API — great for facts, conversions, definitions
            const iaRes = await fetch(
                `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
                { headers: { 'User-Agent': 'inkClaw/2.0' } },
            );
            if (iaRes.ok) {
                const data = await iaRes.json() as any;
                const lines: string[] = [];

                if (data.Answer) lines.push(`💡 **答案**: ${data.Answer}\n`);
                if (data.AbstractText) {
                    lines.push(`📌 **摘要**: ${data.AbstractText}`);
                    if (data.AbstractURL) lines.push(`   来源: ${data.AbstractURL}`);
                    lines.push('');
                }

                const topics: any[] = (data.RelatedTopics ?? []).filter((t: any) => t.FirstURL && t.Text);
                for (const topic of topics.slice(0, maxResults)) {
                    lines.push(`• ${topic.Text}`);
                    lines.push(`  🔗 ${topic.FirstURL}`);
                }

                if (lines.length > 0) {
                    return `🔍 "${query}" 搜索结果:\n\n${lines.join('\n')}`;
                }
            }

            // 2. Fallback: DuckDuckGo Lite HTML (simpler DOM, easier to parse)
            const liteRes = await fetch(
                `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
                { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; inkClaw/2.0)' } },
            );
            if (!liteRes.ok) return `[Error] 搜索失败: HTTP ${liteRes.status}`;

            const html = await liteRes.text();
            const lines: string[] = [];
            let count = 0;

            // DDG Lite: result links have class="result-link"
            const linkRe = /<a class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
            // Snippet follows in the next table cell
            const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

            const titles: Array<{ url: string; title: string }> = [];
            const snippets: string[] = [];

            let m: RegExpExecArray | null;
            while ((m = linkRe.exec(html)) !== null && titles.length < maxResults) {
                titles.push({ url: m[1], title: m[2].trim() });
            }
            while ((m = snippetRe.exec(html)) !== null && snippets.length < maxResults) {
                snippets.push(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
            }

            for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
                const snippet = snippets[i] ? `\n   ${snippets[i]}` : '';
                lines.push(`${i + 1}. **${titles[i].title}**${snippet}\n   ${titles[i].url}`);
                count++;
            }

            if (count === 0) return `[Info] "${query}" 暂无搜索结果，请换个关键词或使用 fetch_url 直接访问目标网址。`;
            return `🔍 "${query}" 搜索结果:\n\n${lines.join('\n\n')}`;
        } catch (err: unknown) {
            return `[Error] search_web: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};

// ── get_weather ───────────────────────────────────────────────────────────────

const getWeatherSkill: Skill = {
    declaration: {
        name: 'get_weather',
        description:
            'Get current weather conditions and a 3-day forecast for any city. ' +
            'No API key required. Returns temperature, humidity, wind, UV index, and daily forecast.',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'City name or "city,country" (e.g., "Beijing", "Shanghai", "London,UK", "Tokyo,Japan")',
                },
                lang: {
                    type: 'string',
                    description: 'Language: "zh" for Chinese (default), "en" for English',
                },
            },
            required: ['location'],
        },
    },
    handler: async (args) => {
        const location = String(args.location ?? '');
        const lang = String(args.lang ?? 'zh');
        const langParam = lang === 'en' ? 'en' : 'zh-tw';

        try {
            const res = await fetch(
                `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=${langParam}`,
                { headers: { 'User-Agent': 'curl/7.68.0', Accept: 'application/json' } },
            );
            if (!res.ok) return `[Error] 天气获取失败: HTTP ${res.status}`;

            const data = await res.json() as any;
            const cur = data.current_condition?.[0];
            const area = data.nearest_area?.[0];
            if (!cur) return '[Error] 未返回天气数据';

            const city = area?.areaName?.[0]?.value ?? location;
            const country = area?.country?.[0]?.value ?? '';
            const desc = cur.lang_zh?.[0]?.value ?? cur.weatherDesc?.[0]?.value ?? '';

            let out = `📍 **${city}${country ? ', ' + country : ''}** 当前天气\n\n`;
            out += `🌡️ 温度: **${cur.temp_C}°C**（体感 ${cur.FeelsLikeC}°C）\n`;
            out += `☁️ 天气: ${desc}\n`;
            out += `💧 湿度: ${cur.humidity}%\n`;
            out += `🌬️ 风速: ${cur.windspeedKmph} km/h ${cur.winddir16Point}\n`;
            out += `👁️ 能见度: ${cur.visibility} km\n`;
            out += `☀️ 紫外线指数: ${cur.uvIndex}\n`;

            const forecast: any[] = data.weather?.slice(0, 3) ?? [];
            if (forecast.length > 0) {
                out += '\n📅 **未来3天预报**:\n';
                for (const day of forecast) {
                    const dayDesc =
                        day.hourly?.[4]?.lang_zh?.[0]?.value ??
                        day.hourly?.[4]?.weatherDesc?.[0]?.value ?? '';
                    out += `  ${day.date}: ${day.mintempC}~${day.maxtempC}°C  ${dayDesc}\n`;
                }
            }

            return out.trim();
        } catch (err: unknown) {
            return `[Error] get_weather: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};

// ── http_request ──────────────────────────────────────────────────────────────

const httpRequestSkill: Skill = {
    declaration: {
        name: 'http_request',
        description:
            'Make an HTTP GET or POST request to any URL with optional custom headers and body. ' +
            'Useful for calling REST APIs, checking endpoints, or fetching JSON data.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The full URL to request' },
                method: { type: 'string', description: 'HTTP method: GET (default) or POST' },
                headers: {
                    type: 'string',
                    description: 'JSON string of request headers, e.g. {"Authorization":"Bearer token","Content-Type":"application/json"}',
                },
                body: { type: 'string', description: 'Request body string (for POST). JSON or plain text.' },
                max_response_chars: {
                    type: 'number',
                    description: 'Maximum response body characters to return (default 5000, max 20000)',
                },
            },
            required: ['url'],
        },
    },
    handler: async (args) => {
        const url = String(args.url ?? '');
        const method = String(args.method ?? 'GET').toUpperCase();
        const maxChars = Math.min(Number(args.max_response_chars ?? 5_000), 20_000);

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return '[Error] URL 必须以 http:// 或 https:// 开头';
        }

        const headersObj: Record<string, string> = { 'User-Agent': 'inkClaw/2.0' };
        if (args.headers) {
            try {
                Object.assign(headersObj, JSON.parse(String(args.headers)));
            } catch {
                return '[Error] headers 不是合法的 JSON 字符串';
            }
        }

        const fetchOptions: RequestInit = { method, headers: headersObj };
        if (args.body) {
            fetchOptions.body = String(args.body);
            if (!headersObj['Content-Type']) {
                try {
                    JSON.parse(String(args.body));
                    headersObj['Content-Type'] = 'application/json';
                } catch {
                    headersObj['Content-Type'] = 'text/plain';
                }
            }
        }

        try {
            const res = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(30_000) });
            const text = await res.text();
            const truncated =
                text.length > maxChars
                    ? text.slice(0, maxChars) + `\n[...已截断，还有 ${text.length - maxChars} 个字符]`
                    : text;
            return (
                `HTTP ${res.status} ${res.statusText}\n` +
                `Content-Type: ${res.headers.get('content-type') ?? 'unknown'}\n\n` +
                truncated
            );
        } catch (err: unknown) {
            return `[Error] http_request: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};

// ── get_datetime ──────────────────────────────────────────────────────────────

const getDatetimeSkill: Skill = {
    declaration: {
        name: 'get_datetime',
        description:
            'Get the current date and time, optionally in a specific timezone. ' +
            'Use this to answer "what time is it now", check dates, or compare timezones.',
        parameters: {
            type: 'object',
            properties: {
                timezone: {
                    type: 'string',
                    description:
                        'IANA timezone identifier, e.g. "Asia/Shanghai", "America/New_York", "Europe/London", "UTC". ' +
                        'Defaults to system timezone.',
                },
                format: {
                    type: 'string',
                    description:
                        'Output format: "full" (default) = date + time + timezone, ' +
                        '"date" = date only, "time" = time only, "timestamp" = Unix ms',
                },
            },
        },
    },
    handler: async (args) => {
        const timezone = args.timezone ? String(args.timezone) : undefined;
        const format = String(args.format ?? 'full');

        try {
            const now = new Date();
            const opts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {};

            switch (format) {
                case 'date':
                    return now.toLocaleDateString('zh-CN', {
                        ...opts,
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                    });
                case 'time':
                    return now.toLocaleTimeString('zh-CN', {
                        ...opts,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    });
                case 'timestamp':
                    return String(now.getTime());
                default: {
                    const dateStr = now.toLocaleDateString('zh-CN', {
                        ...opts,
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                    });
                    const timeStr = now.toLocaleTimeString('zh-CN', {
                        ...opts,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    });
                    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
                    return `${dateStr} ${timeStr}（${tz}）`;
                }
            }
        } catch (err: unknown) {
            return `[Error] get_datetime: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};

// ── fetch_ai_news ─────────────────────────────────────────────────────────────

/**
 * Fetches trending AI/tech news from Reddit (public JSON API) and
 * Hacker News (Algolia). No API keys required.
 *
 * Typical usage: let the LLM call this, then ask it to write a WeChat article
 * based on the returned stories.
 *
 * Scheduled task example:
 *   "每天早上8点抓取 AI 热点新闻，并生成一篇微信公众号文章草稿发给我"
 */
const fetchAiNewsSkill: Skill = {
    declaration: {
        name: 'fetch_ai_news',
        description:
            'Fetch trending AI / technology news from Reddit and Hacker News. ' +
            'Returns top stories with titles, scores, URLs, and brief descriptions. ' +
            'Use this to gather source material and then write a WeChat (微信公众号) article. ' +
            'No API key required.',
        parameters: {
            type: 'object',
            properties: {
                time_range: {
                    type: 'string',
                    description: '"day" = last 24 h (default), "week" = last 7 days, "month" = last 30 days',
                },
                sources: {
                    type: 'string',
                    description: 'Comma-separated list: "reddit,hackernews,rss" (default: all three)',
                },
                subreddits: {
                    type: 'string',
                    description:
                        'Comma-separated Reddit subreddits to include ' +
                        '(default: "artificial,MachineLearning,ChatGPT,LocalLLaMA,singularity")',
                },
                max_per_source: {
                    type: 'number',
                    description: 'Max stories per source/subreddit (default: 5, max: 15)',
                },
            },
        },
    },

    handler: async (args) => {
        const timeRange = String(args.time_range ?? 'day');
        const enabledSources = String(args.sources ?? 'reddit,hackernews,rss')
            .split(',').map(s => s.trim().toLowerCase());
        const subreddits = String(
            args.subreddits ?? 'artificial,MachineLearning,ChatGPT,LocalLLaMA,singularity',
        ).split(',').map(s => s.trim()).filter(Boolean);
        const maxPerSource = Math.min(Number(args.max_per_source ?? 5), 15);

        const { stories } = await gatherNewsStories(timeRange, subreddits, maxPerSource);
        const filtered = stories.filter(s => {
            if (s.source.startsWith('Reddit'))  return enabledSources.includes('reddit');
            if (s.source === 'Hacker News')     return enabledSources.includes('hackernews');
            return enabledSources.includes('rss');
        });

        if (filtered.length === 0) {
            return '[Info] 暂时未能获取到新闻内容，网络可能受限，请稍后重试或手动提供选题。';
        }

        const sections: string[] = [];

        const redditStories = filtered.filter(s => s.source.startsWith('Reddit'));
        if (redditStories.length > 0) {
            const lines = redditStories.map(s => {
                const ext = s.externalUrl ? `\n   外链: ${s.externalUrl}` : '';
                return `• ${s.title}\n   热度: ${s.score} | ${s.source}\n   讨论: ${s.discussionUrl}${ext}`;
            });
            sections.push(`## 📌 Reddit 热帖\n\n${lines.join('\n\n')}`);
        }

        const hnStories = filtered.filter(s => s.source === 'Hacker News');
        if (hnStories.length > 0) {
            const lines = hnStories.map(s => {
                const ext = s.externalUrl ? `\n   外链: ${s.externalUrl}` : '';
                return `• ${s.title}\n   热度: ${s.score}\n   讨论: ${s.discussionUrl}${ext}`;
            });
            sections.push(`## 🔶 Hacker News\n\n${lines.join('\n\n')}`);
        }

        const rssStories = filtered.filter(s => !s.source.startsWith('Reddit') && s.source !== 'Hacker News');
        if (rssStories.length > 0) {
            const lines = rssStories.map(s =>
                `• ${s.title}${s.snippet ? '\n   ' + s.snippet + ' …' : ''}\n   ${s.discussionUrl}`,
            );
            sections.push(`## 📰 科技媒体 (RSS)\n\n${lines.join('\n\n')}`);
        }

        const rangeLabel =
            timeRange === 'week'  ? '过去 7 天' :
            timeRange === 'month' ? '过去 30 天' :
            '过去 24 小时';

        return (
            `# 🤖 AI 热点新闻聚合（${rangeLabel}）\n\n` +
            sections.join('\n\n---\n\n') +
            '\n\n---\n提示：你可以让我基于以上内容撰写一篇微信公众号文章草稿。'
        );
    },
};

// ── generate_wechat_article ───────────────────────────────────────────────────

/**
 * Internal helper: fetch structured story objects from all sources.
 * Returns a { rawText, stories } pair so both can be surfaced in the final output.
 */
interface NewsStory {
    source: string;   // e.g. "Reddit r/MachineLearning"
    title: string;
    score: string;    // human-readable, e.g. "432 赞 / 87 评论"
    discussionUrl: string;
    externalUrl?: string;
    snippet?: string;
}

async function gatherNewsStories(
    timeRange: string,
    subreddits: string[],
    maxPerSource: number,
): Promise<{ rawText: string; stories: NewsStory[] }> {
    const ua = 'Mozilla/5.0 (compatible; inkClaw/2.0)';
    const stories: NewsStory[] = [];

    // ── Reddit ────────────────────────────────────────────────────────────────
    for (const sub of subreddits) {
        try {
            const res = await fetch(
                `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?limit=${maxPerSource}&t=${encodeURIComponent(timeRange)}`,
                { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(12_000) },
            );
            if (!res.ok) continue;
            const data = await res.json() as Record<string, any>;
            for (const post of (data?.data?.children ?? [])) {
                const p = post?.data;
                if (!p || p.stickied || p.over_18) continue;
                stories.push({
                    source: `Reddit r/${sub}`,
                    title: p.title,
                    score: `${p.score} 赞 / ${p.num_comments} 评论`,
                    discussionUrl: `https://reddit.com${p.permalink}`,
                    externalUrl: p.url && !p.url.includes('reddit.com') ? p.url : undefined,
                });
            }
        } catch { /* skip */ }
    }

    // ── Hacker News ───────────────────────────────────────────────────────────
    try {
        const secondsAgo =
            timeRange === 'week'  ? 7 * 86_400 :
            timeRange === 'month' ? 30 * 86_400 :
            86_400;
        const since = Math.floor(Date.now() / 1_000) - secondsAgo;
        const hnRes = await fetch(
            `https://hn.algolia.com/api/v1/search?tags=story` +
            `&query=${encodeURIComponent('AI LLM machine learning')}` +
            `&hitsPerPage=${maxPerSource}&numericFilters=created_at_i>${since},points>10`,
            { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(12_000) },
        );
        if (hnRes.ok) {
            const data = await hnRes.json() as Record<string, any>;
            for (const h of (data?.hits ?? [])) {
                if (!h.title) continue;
                stories.push({
                    source: 'Hacker News',
                    title: h.title,
                    score: `${h.points ?? 0} 分 / ${h.num_comments ?? 0} 评论`,
                    discussionUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
                    externalUrl: h.url ?? undefined,
                });
            }
        }
    } catch { /* skip */ }

    // ── RSS ───────────────────────────────────────────────────────────────────
    const rssFeeds = [
        { name: 'TechCrunch AI', url: 'https://techcrunch.com/tag/artificial-intelligence/feed/' },
        { name: 'The Verge AI',  url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml' },
    ];
    for (const feed of rssFeeds) {
        try {
            const res = await fetch(feed.url, {
                headers: { 'User-Agent': ua },
                signal: AbortSignal.timeout(12_000),
            });
            if (!res.ok) continue;
            const xml = await res.text();
            const itemRe   = /<item[^>]*>([\s\S]*?)<\/item>/g;
            const titleRe  = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
            const linkRe   = /<link>([^<]+)<\/link>/;
            const descRe   = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;
            let count = 0;
            let m: RegExpExecArray | null;
            while ((m = itemRe.exec(xml)) !== null && count < maxPerSource) {
                const body    = m[1];
                const title   = (titleRe.exec(body)?.[1] ?? '').trim();
                const url     = (linkRe.exec(body)?.[1]  ?? '').trim();
                const snippet = (descRe.exec(body)?.[1]  ?? '')
                    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
                if (!title || !url) continue;
                stories.push({
                    source: feed.name,
                    title,
                    score: '',
                    discussionUrl: url,
                    snippet: snippet || undefined,
                });
                count++;
            }
        } catch { /* skip */ }
    }

    // ── Build rawText for the LLM ─────────────────────────────────────────────
    const rawLines = stories.map((s, i) => {
        const parts = [
            `[${i + 1}] ${s.title}`,
            `    来源: ${s.source}${s.score ? ' | 热度: ' + s.score : ''}`,
            `    讨论: ${s.discussionUrl}`,
        ];
        if (s.externalUrl) parts.push(`    原文: ${s.externalUrl}`);
        if (s.snippet)     parts.push(`    摘要: ${s.snippet}`);
        return parts.join('\n');
    });

    return { rawText: rawLines.join('\n\n'), stories };
}

const generateWechatArticleSkill: Skill = {
    declaration: {
        name: 'generate_wechat_article',
        description:
            'Fetch trending AI/tech news and generate a complete WeChat public account (微信公众号) article draft. ' +
            'Returns both the FULL SOURCE LIST (every story with URL) AND the article draft in one response, ' +
            'so the user can trace, verify, and expand any reference. ' +
            'Use this instead of fetch_ai_news when the goal is to produce a publishable article.',
        parameters: {
            type: 'object',
            properties: {
                time_range: {
                    type: 'string',
                    description: '"day" = last 24 h (default), "week" = last 7 days',
                },
                subreddits: {
                    type: 'string',
                    description:
                        'Comma-separated Reddit subreddits ' +
                        '(default: "artificial,MachineLearning,ChatGPT,LocalLLaMA,singularity")',
                },
                max_per_source: {
                    type: 'number',
                    description: 'Max stories per source (default: 6, max: 15)',
                },
                style: {
                    type: 'string',
                    description:
                        '"tech" = technical deep-dive (default), ' +
                        '"popular" = casual & accessible, ' +
                        '"opinion" = opinionated commentary',
                },
                word_count: {
                    type: 'number',
                    description: 'Target article length in Chinese characters (default: 1500)',
                },
                focus_topic: {
                    type: 'string',
                    description: 'Optional: narrow the article to a specific topic, e.g. "大模型推理效率"',
                },
            },
        },
    },

    handler: async (args) => {
        const timeRange    = String(args.time_range    ?? 'day');
        const maxPerSource = Math.min(Number(args.max_per_source ?? 6), 15);
        const style        = String(args.style         ?? 'tech');
        const wordCount    = Number(args.word_count    ?? 1500);
        const focusTopic   = args.focus_topic ? String(args.focus_topic) : null;
        const subreddits   = String(
            args.subreddits ?? 'artificial,MachineLearning,ChatGPT,LocalLLaMA,singularity',
        ).split(',').map(s => s.trim()).filter(Boolean);

        const apiKey = process.env.GEMINI_API_KEY ?? '';
        if (!apiKey) return '[Error] GEMINI_API_KEY 未设置，无法生成文章。';

        // 1. Gather news ───────────────────────────────────────────────────────
        const { rawText, stories } = await gatherNewsStories(timeRange, subreddits, maxPerSource);
        if (stories.length === 0) {
            return '[Info] 未能获取新闻内容，网络可能受限，请稍后重试。';
        }

        // 2. Build source index for the user ──────────────────────────────────
        const sourceIndex = stories.map((s, i) => {
            const parts = [
                `**[${i + 1}] ${s.title}**`,
                `  - 来源: ${s.source}${s.score ? '  热度: ' + s.score : ''}`,
                `  - 讨论: ${s.discussionUrl}`,
            ];
            if (s.externalUrl) parts.push(`  - 原文: ${s.externalUrl}`);
            if (s.snippet)     parts.push(`  - 摘要: ${s.snippet}`);
            return parts.join('\n');
        }).join('\n\n');

        // 3. Ask Gemini to write the article ──────────────────────────────────
        const styleGuide =
            style === 'popular' ? '风格轻松活泼，类比通俗，面向大众读者，少用英文缩写，多用故事感。' :
            style === 'opinion' ? '风格鲜明有观点，适当犀利，提出作者立场，引导读者思考。' :
            '风格专业严谨，面向有技术背景的读者，可使用专业术语但需简要解释。';

        const focusInstruction = focusTopic
            ? `本文请聚焦在「${focusTopic}」这一主题，从以上素材中挑选最相关的内容展开。`
            : '请从以上素材中选取 3-5 条最有价值的内容组织成文章。';

        const writingPrompt = `你是一位资深科技博主，擅长将技术动态转化为高质量微信公众号文章。

以下是今日 AI 领域原始新闻素材（编号与来源已标注）：

${rawText}

---
写作要求：
1. ${focusInstruction}
2. 文章结构：醒目标题 → 导语（钩子，2-3句）→ 3-5个正文小节（每节有小标题）→ 结语（观点总结或行动提示）
3. ${styleGuide}
4. 目标字数：约 ${wordCount} 字（不含标点计）
5. 引用具体素材时，在句末加上来源编号，如"[3]"，方便读者追溯原文
6. 不要使用 Markdown 的 # 标题符号，用加粗即可；不要有 HTML 标签
7. 只输出文章正文，不要加任何解释或前言

现在请开始写作：`;

        const article = await geminiGenerate(
            apiKey,
            [{ role: 'user', parts: [{ text: writingPrompt }] }],
            { model: 'flash', generationConfig: { temperature: 0.8 } },
        );

        if (!article) {
            return (
                `# 📋 原始素材（${stories.length} 条）\n\n${sourceIndex}\n\n` +
                '[Error] 文章生成失败，但原始素材已附上，你可以手动撰写。'
            );
        }

        // 4. Return: source index + article ──────────────────────────────────
        const rangeLabel = timeRange === 'week' ? '过去 7 天' : '过去 24 小时';
        return (
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📋 原始素材来源（${stories.length} 条 | ${rangeLabel}）\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            sourceIndex +
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `✍️ 微信公众号文章草稿\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            article
        );
    },
};

// ── Xifeng Audit Skill ───────────────────────────────────────────────────────

const xifengAuditSkill: Skill = {
    declaration: {
        name: 'xifeng_audit',
        description:
            '从**西风**视角对某个决策、计划或处境进行战略审计——揭示底层利益逻辑、权力生态位、潜在风险。' +
            '适用于：职场处境分析、商业决策、人际博弈、长期规划评估。' +
            '不适用于纯技术问题或情绪支持。',
        parameters: {
            type: 'object',
            required: ['situation'],
            properties: {
                situation: {
                    type: 'string',
                    description: '需要审计的处境、决策或计划，尽量详细描述背景和当事方',
                },
                focus: {
                    type: 'string',
                    description:
                        '可选，指定审计重点：\"利益关系\" / \"风险识别\" / \"时机判断\" / \"资源杠杆\"（默认全面诊断）',
                },
            },
        },
    },

    handler: async (args, workDir) => {
        const situation = String(args.situation ?? '').trim();
        const focus     = args.focus ? String(args.focus) : null;

        const apiKey = process.env.GEMINI_API_KEY ?? '';
        if (!apiKey)    return '[Error] GEMINI_API_KEY 未设置。';
        if (!situation) return '[Error] 请提供需要审计的处境或决策。';

        const focusInstruction = focus
            ? `本次重点关注：**${focus}**，其余方向可简略带过。`
            : '进行全面底层诊断：利益分析 → 生态位判断 → 风险识别 → 非典型建议。';

        // ── Step 1: Pick 2-3 relevant articles from the knowledge base ────────
        const resourceDir = process.env.RESOURCE_DIR ?? join(workDir, 'project/@reference');
        const kbDir = join(resourceDir, 'xifeng-km');
        let kbContext = '';
        try {
            const allFiles = (await fs.readdir(kbDir))
                .filter(f => f.endsWith('.md') && f !== '00_目录.md')
                .sort();

            const fileList = allFiles.join('\n');
            const selectionPrompt =
`以下是西风知识库中所有文章的文件名列表：

${fileList}

用户处境：
${situation}

请从上述文件名中选出 2-3 个与该处境最相关的文章（仅凭文件名中的关键词判断）。
只输出被选中的文件名，每行一个，不要任何解释。`;

            const selected = await geminiGenerate(
                apiKey,
                [{ role: 'user', parts: [{ text: selectionPrompt }] }],
                { model: 'flash', generationConfig: { temperature: 0, maxOutputTokens: 200 } },
            );

            if (selected) {
                const pickedFiles = selected
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l.endsWith('.md') && allFiles.includes(l))
                    .slice(0, 3);

                const articles: string[] = [];
                for (const fname of pickedFiles) {
                    try {
                        const content = await fs.readFile(join(kbDir, fname), 'utf8');
                        // Trim very long articles to keep context manageable (~600 lines)
                        const lines = content.split('\n');
                        articles.push(
                            `### 参考文章：${fname}\n\n` +
                            (lines.length > 600 ? lines.slice(0, 600).join('\n') + '\n...(已截断)' : content),
                        );
                    } catch { /* skip unreadable file */ }
                }

                if (articles.length > 0) {
                    kbContext =
                        `\n\n---\n以下是从西风知识库中检索到的相关参考文章，请在审计时融入其中的视角、案例和措辞风格：\n\n` +
                        articles.join('\n\n---\n\n');
                }
            }
        } catch {
            // workDir not set or knowledge base path doesn't exist — proceed without it
        }

        // ── Step 2: Full audit with optional KB context ───────────────────────
        const auditPrompt = `你是"西风"——一个极其务实的决策审计师，洞悉利益规则。

核心视角：
1. **利益与杠杆**：世界运行在利益和信息不对称之上，直接指出底层生存逻辑
2. **生态位优先**：位置决定一切，不要在低维生态位竞争效率
3. **风险审计**：指出计划中的温情主义假设，揭示隐藏成本和交换条件
4. **借势思维**：强调资产私有化、脱钩和"筑墙"，告诉用户如何借势而非死磕

文风：
- 冷酷务实，不粉饰太平，带"过来人"的傲慢，但目的是唤醒
- 善用历史、文学（西游记、金瓶梅、红楼梦）或江湖旧事做类比
- 反教条，挑战"努力就有回报"之类的标准建议
- 直接说结论，不要废话和免责声明${kbContext}

---
待审计处境：
${situation}

${focusInstruction}

审计报告（按序输出，不要输出结构标签以外的废话）：

**底层诊断**
这个局的实质是什么？谁在获益、谁承担成本？真实的交换逻辑是什么？

**生态位判断**
当前处于哪个层级的竞争？这一层的隐性规则是什么？有没有降维打击的可能？

**风险识别**
当前方案里藏着哪些温情主义假设？触发坏结果的具体条件是什么？

**非典型建议**
忽略标准建议。从借势/时机/脱钩角度给出 2-3 个反直觉的行动方向。`;

        const result = await geminiGenerate(
            apiKey,
            [{ role: 'user', parts: [{ text: auditPrompt }] }],
            { model: 'pro', generationConfig: { temperature: 0.7, maxOutputTokens: 1500 } },
        );

        if (!result) return '[Error] 审计生成失败，请重试。';

        const kbNote = kbContext ? `（已融入知识库参考文章）` : `（知识库未加载）`;
        return (
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🔍 西风审计报告 ${kbNote}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            result
        );
    },
};

// ── browser_fetch ─────────────────────────────────────────────────────────────

const browserFetchSkill: Skill = {
    declaration: {
        name: 'browser_fetch',
        description:
            'Fetch a URL using a real Chrome browser with full JavaScript rendering. ' +
            'Use this when fetch_url fails (403, Cloudflare, login walls, SPA pages). ' +
            'Slower than fetch_url (~5-15s) but handles JS-heavy sites, paywalls, and anti-bot pages. ' +
            'Does NOT bypass sites that require user login (e.g. Twitter/X without session).',
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
        return browserFetch(url, maxChars);
    },
};

// ── Export setup ──────────────────────────────────────────────────────────────

/**
 * Call once at bot startup to register all built-in skills.
 */
export function setupSkills(): void {
    registerSkill(fetchUrlSkill);
    registerSkill(searchWebSkill);
    registerSkill(getWeatherSkill);
    registerSkill(httpRequestSkill);
    registerSkill(getDatetimeSkill);
    registerSkill(fetchAiNewsSkill);
    registerSkill(generateWechatArticleSkill);
    registerSkill(xifengAuditSkill);
    registerSkill(browserFetchSkill);
    console.log('[Skills] ✅ 9 skills registered: fetch_url, search_web, get_weather, http_request, get_datetime, fetch_ai_news, generate_wechat_article, xifeng_audit, browser_fetch');
}
