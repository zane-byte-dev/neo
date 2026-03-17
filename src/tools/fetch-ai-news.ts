import type { Tool } from './_base.js';
import { gatherNewsStories } from './_news-helper.js';

export const fetchAiNewsTool: Tool = {
    meta: { category: 'ai', version: '1.0.0' },
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
