/** Shared data types and helper used by fetch-ai-news and generate-wechat-article. */

export interface NewsStory {
    source: string;
    title: string;
    score: string;
    discussionUrl: string;
    externalUrl?: string;
    snippet?: string;
}

export async function gatherNewsStories(
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
