import { geminiGenerate } from '../lib/gemini-client.js';
import type { Message } from '../lib/chat-history-cache.js';
import type { Command } from './_base.js';

export const conversationCommand: Command = {
    commands: ['/compact'],
    handler: async (command, _text, ctx, deps) => {
    if (command !== '/compact') return false;

    const msgs = deps.chatHistoryCache.getCurrentSessionHistory();
    if (msgs.length < 3) {
        await ctx.reply('💬 当前对话太短（< 3 条），无需压缩。');
        return true;
    }

    const statusMsg = await deps.bot.telegram.sendMessage(ctx.chat.id, '⏳ 正在压缩上下文...');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        await deps.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ 需要配置 GEMINI_API_KEY。').catch(() => {});
        return true;
    }

    const transcript = msgs.map((m: Message) => {
        const role = m.role === 'user' ? (m.userName ?? 'User') : 'Assistant';
        const body = m.content.length > 3000 ? m.content.slice(0, 3000) + '...(truncated)' : m.content;
        return `${role}: ${body}`;
    }).join('\n\n');

    const compactPrompt = `你的任务是为以下对话生成一份详细的结构化摘要，以便后续对话无缝衔接，不丢失上下文。

在生成摘要之前，先用 <analysis> 标签整理思路，逐条梳理对话中的请求、决策、技术细节、错误与修复、用户反馈。确保覆盖全部关键信息后，再输出 <summary>。

<summary> 必须包含以下九个章节：

1. **主要请求与意图**：用户的全部明确请求和目标，详细描述
2. **关键技术概念**：对话中涉及的重要技术概念、框架、工具
3. **文件与代码**：查看、修改或新建的文件，包含关键代码片段及其重要性说明
4. **报错与修复**：遇到的每个报错以及如何修复；包含用户的具体反馈（如"用户说不要这样做"）
5. **问题解决过程**：已解决的问题，以及仍在排查中的问题
6. **所有用户消息**：列出用户发送的所有非工具结果消息（这些是理解用户意图变化的关键）
7. **待办任务**：明确被要求完成但尚未完成的任务
8. **当前工作**：在这次摘要请求之前，正在处理的具体工作（附文件名和代码片段）
9. **下一步（可选）**：若有明确的后续步骤，列出并用原文引用最近对话中的相关表述，避免任务漂移

输出格式示例：

<analysis>
[逐条分析，确保覆盖所有要点]
</analysis>

<summary>
1. 主要请求与意图：
   [详细描述]

2. 关键技术概念：
   - [概念1]
   - [概念2]

3. 文件与代码：
   - [文件名]
     - [重要性说明]
     - [关键代码片段]

4. 报错与修复：
   - [报错描述]：[修复方法] / [用户反馈]

5. 问题解决过程：
   [描述]

6. 所有用户消息：
   - [消息1]
   - [消息2]

7. 待办任务：
   - [任务1]
   - [任务2]

8. 当前工作：
   [精确描述]

9. 下一步（可选）：
   [下一步及原文引用]
</summary>

以下是需要压缩的对话内容：

${transcript}`;

    const summary = await geminiGenerate(
        apiKey,
        [{ parts: [{ text: compactPrompt }] }],
        { generationConfig: { temperature: 0.2, maxOutputTokens: 3000 } }
    );

    if (!summary) {
        await deps.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ 压缩失败，请重试。').catch(() => {});
        return true;
    }

    // Strip <analysis> scratchpad block — only store the <summary> section
    const cleanSummary = summary
        .replace(/<analysis>[\s\S]*?<\/analysis>/g, '')
        .replace(/<summary>([\s\S]*?)<\/summary>/g, '$1')
        .trim();

    const stored = cleanSummary || summary.trim();
    await deps.chatHistoryCache.compactWithSummary(stored);

    // Telegram max message length is 4096; truncate preview if needed
    const preview = stored.length > 3000 ? stored.slice(0, 3000) + '\n\n…（摘要过长，已截断显示）' : stored;
    await deps.bot.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined,
        `✅ 上下文已压缩（${msgs.length} 条 → 1 条摘要）\n\n${preview}`,
        { parse_mode: 'Markdown' }
    ).catch(async () => {
        await ctx.reply(`✅ 已压缩 ${msgs.length} 条消息。\n\n${preview}`);
    });

    return true;
    },
};
