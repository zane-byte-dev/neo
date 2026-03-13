/**
 * skills.ts — Pluggable skill definitions for the GeminiClient agent runtime.
 *
 * Each skill adds a new tool that the LLM can call during its agentic loop.
 * Register skills before the first prompt is sent; they're merged into the
 * function-calling declarations sent to the Gemini API.
 *
 * Built-in skills:
 *   fetch_url    — Fetch a web page and return clean plain text
 *   search_web   — Search the web via DuckDuckGo
 *   get_weather  — Real-time weather via wttr.in (no API key needed)
 *   http_request — Generic HTTP GET / POST to any API
 *   get_datetime — Current date/time with optional timezone
 */

import { registerSkill, Skill } from './gemini-client.js';

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

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);

        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NeoAgent/2.0)' },
            });
            if (!res.ok) return `[Error] HTTP ${res.status} ${res.statusText}`;

            const html = await res.text();
            const text = html
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

            return text.length > maxChars
                ? text.slice(0, maxChars) + `\n\n[...已截断，还有 ${text.length - maxChars} 个字符]`
                : text;
        } catch (err: unknown) {
            return `[Error] fetch_url: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
            clearTimeout(timer);
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
                { headers: { 'User-Agent': 'NeoAgent/2.0' } },
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
                { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NeoAgent/2.0)' } },
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

        const headersObj: Record<string, string> = { 'User-Agent': 'NeoAgent/2.0' };
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

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);

        try {
            const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
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
        } finally {
            clearTimeout(timer);
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
    console.log('[Skills] ✅ 5 skills registered: fetch_url, search_web, get_weather, http_request, get_datetime');
}
