import type { Tool } from './_base.js';
import { gatherNewsStories } from './_news-helper.js';
import { geminiGenerate } from '../services/gemini-client.js';

export const generateWechatArticleTool: Tool = {
    meta: { category: 'ai', version: '1.0.0', requiresEnv: ['GEMINI_API_KEY'] },
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

        const { rawText, stories } = await gatherNewsStories(timeRange, subreddits, maxPerSource);
        if (stories.length === 0) {
            return '[Info] 未能获取新闻内容，网络可能受限，请稍后重试。';
        }

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
