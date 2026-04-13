import type { Tool } from '../_base.js';

export const searchWebTool: Tool = {
    meta: { category: 'web', version: '1.0.0' },
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
            // 1. Instant Answer API
            const iaRes = await fetch(
                `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
                { headers: { 'User-Agent': 'inkClaw/2.0' }, signal: AbortSignal.timeout(15_000) },
            );
            if (iaRes.ok) {
                const data = await iaRes.json() as { Answer?: string; AbstractText?: string; AbstractURL?: string; RelatedTopics?: Array<{ FirstURL?: string; Text?: string }> };
                const lines: string[] = [];

                if (data.Answer) lines.push(`💡 **答案**: ${data.Answer}\n`);
                if (data.AbstractText) {
                    lines.push(`📌 **摘要**: ${data.AbstractText}`);
                    if (data.AbstractURL) lines.push(`   来源: ${data.AbstractURL}`);
                    lines.push('');
                }

                const topics = (data.RelatedTopics ?? []).filter((t) => t.FirstURL && t.Text);
                for (const topic of topics.slice(0, maxResults)) {
                    lines.push(`• ${topic.Text}`);
                    lines.push(`  🔗 ${topic.FirstURL}`);
                }

                if (lines.length > 0) {
                    return `🔍 "${query}" 搜索结果:\n\n${lines.join('\n')}`;
                }
            }

            // 2. Fallback: DuckDuckGo Lite HTML
            const liteRes = await fetch(
                `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
                { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; inkClaw/2.0)' }, signal: AbortSignal.timeout(15_000) },
            );
            if (!liteRes.ok) return `[Error] 搜索失败: HTTP ${liteRes.status}`;

            const html = await liteRes.text();
            const lines: string[] = [];
            let count = 0;

            const linkRe = /<a class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
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
