#!/usr/bin/env node
/**
 * fetch-ai-news — 从 Reddit / Hacker News / RSS 聚合 AI 热点新闻
 * stdin: JSON { args, context }
 * stdout: JSON { type: 'text', content: '...' }
 */

async function main() {
    const raw = await new Promise((resolve) => {
        let data = '';
        process.stdin.on('data', (chunk) => (data += chunk));
        process.stdin.on('end', () => resolve(data));
    });

    const { args } = JSON.parse(raw);
    const timeRange = String(args.time_range ?? 'day');
    const enabledSources = String(args.sources ?? 'reddit,hackernews,rss')
        .split(',').map(s => s.trim().toLowerCase());
    const subreddits = String(
        args.subreddits ?? 'artificial,MachineLearning,ChatGPT,LocalLLaMA,singularity',
    ).split(',').map(s => s.trim()).filter(Boolean);
    const maxPerSource = Math.min(Number(args.max_per_source ?? 5), 15);

    const ua = 'Mozilla/5.0 (compatible; inkClaw/2.0)';
    const stories = [];

    // ── Reddit ────────────────────────────────────────────────────────────
    for (const sub of subreddits) {
        if (!enabledSources.includes('reddit')) break;
        try {
            const res = await fetch(
                `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?limit=${maxPerSource}&t=${encodeURIComponent(timeRange)}`,
                { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(12000) },
            );
            if (!res.ok) continue;
            const data = await res.json();
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

    // ── Hacker News ───────────────────────────────────────────────────────
    if (enabledSources.includes('hackernews')) {
        try {
            const secondsAgo =
                timeRange === 'week'  ? 7 * 86400 :
                timeRange === 'month' ? 30 * 86400 :
                86400;
            const since = Math.floor(Date.now() / 1000) - secondsAgo;
            const hnRes = await fetch(
                `https://hn.algolia.com/api/v1/search?tags=story` +
                `&query=${encodeURIComponent('AI LLM machine learning')}` +
                `&hitsPerPage=${maxPerSource}&numericFilters=created_at_i>${since},points>10`,
                { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(12000) },
            );
            if (hnRes.ok) {
                const data = await hnRes.json();
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
    }

    // ── RSS ───────────────────────────────────────────────────────────────
    if (enabledSources.includes('rss')) {
        const rssFeeds = [
            { name: 'TechCrunch AI', url: 'https://techcrunch.com/tag/artificial-intelligence/feed/' },
            { name: 'The Verge AI',  url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml' },
        ];
        for (const feed of rssFeeds) {
            try {
                const res = await fetch(feed.url, {
                    headers: { 'User-Agent': ua },
                    signal: AbortSignal.timeout(12000),
                });
                if (!res.ok) continue;
                const xml = await res.text();
                const itemRe   = /<item[^>]*>([\s\S]*?)<\/item>/g;
                const titleRe  = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
                const linkRe   = /<link>([^<]+)<\/link>/;
                const descRe   = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;
                let count = 0;
                let m;
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
    }

    // ── Format output ─────────────────────────────────────────────────────
    if (stories.length === 0) {
        console.log(JSON.stringify({
            type: 'text',
            content: '[Info] 暂时未能获取到新闻内容，网络可能受限，请稍后重试或手动提供选题。',
        }));
        return;
    }

    const sections = [];

    const redditStories = stories.filter(s => s.source.startsWith('Reddit'));
    if (redditStories.length > 0) {
        const lines = redditStories.map(s => {
            const ext = s.externalUrl ? `\n   外链: ${s.externalUrl}` : '';
            return `• ${s.title}\n   热度: ${s.score} | ${s.source}\n   讨论: ${s.discussionUrl}${ext}`;
        });
        sections.push(`## 📌 Reddit 热帖\n\n${lines.join('\n\n')}`);
    }

    const hnStories = stories.filter(s => s.source === 'Hacker News');
    if (hnStories.length > 0) {
        const lines = hnStories.map(s => {
            const ext = s.externalUrl ? `\n   外链: ${s.externalUrl}` : '';
            return `• ${s.title}\n   热度: ${s.score}\n   讨论: ${s.discussionUrl}${ext}`;
        });
        sections.push(`## 🔶 Hacker News\n\n${lines.join('\n\n')}`);
    }

    const rssStories = stories.filter(s => !s.source.startsWith('Reddit') && s.source !== 'Hacker News');
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

    const output =
        `# 🤖 AI 热点新闻聚合（${rangeLabel}）\n\n` +
        sections.join('\n\n---\n\n') +
        '\n\n---\n提示：你可以让我基于以上内容撰写一篇微信公众号文章草稿。';

    console.log(JSON.stringify({ type: 'text', content: output }));
}

main();
