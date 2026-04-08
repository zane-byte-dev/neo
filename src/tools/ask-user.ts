/**
 * ask-user.ts — Ask the user a question and wait for their reply.
 *
 * When the AI calls this tool:
 * 1. The question is sent to the user via their platform adapter.
 * 2. The agent loop pauses.
 * 3. The user's next message resolves the promise.
 * 4. The agent loop resumes with the user's answer.
 *
 * Uses user-input-waiter.ts for the pause/resume mechanism.
 * The message-router must check hasPending() before routing messages.
 */
import { waitForUserInput } from '../services/user-input-waiter.js';
import type { Tool, ToolContext } from './_base.js';

export const askUserTool: Tool = {
    meta: { category: 'utility', version: '1.0.0' },
    declaration: {
        name: 'ask_user',
        description:
            '向用户提一个问题并等待回答，然后继续执行。\n' +
            '适用场景：\n' +
            '• 破坏性操作前需要确认（如删除文件、提交代码）\n' +
            '• 需要用户选择方向或提供缺失信息\n' +
            '• 多步骤任务中途需要用户决策\n' +
            '注意：AI 会暂停等待用户回复，最长等待 5 分钟。',
        parameters: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                    description: '发给用户的问题',
                },
                choices: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '可选项列表，展示给用户作为参考（如 ["是", "否", "跳过"]）',
                },
            },
            required: ['question'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const question = String(args.question ?? '').trim();
        if (!question) return '[Error] question is required';

        if (!context) {
            return '[Error] ask_user is not available in this context';
        }

        const chatId = context.chatId;
        if (!chatId) return '[Error] Cannot determine chat ID';

        const choices = Array.isArray(args.choices)
            ? (args.choices as string[]).filter(c => typeof c === 'string' && c)
            : [];

        const messageText = `❓ **AI 需要你的回答：**\n\n${question}`;

        const inlineKeyboard = choices.length > 0
            ? (() => {
                const rows: Array<Array<{ text: string; callbackData: string }>> = [];
                for (let i = 0; i < choices.length; i += 2) {
                    rows.push(
                        choices.slice(i, i + 2).map(c => ({
                            text: c,
                            callbackData: `ask_user:${c}`,
                        }))
                    );
                }
                return rows;
            })()
            : undefined;

        try {
            await context.adapter.sendMessage(chatId, messageText, {
                parseMode: 'markdown',
                inlineKeyboard,
            });
        } catch (err: any) {
            console.error('[AskUserTool] Failed to send question:', err.message);
            return `[Error] Failed to send question to user: ${err.message}`;
        }

        try {
            const answer = await waitForUserInput(chatId);
            return `用户回答：${answer}`;
        } catch (err: any) {
            return `[Error] ${err.message}`;
        }
    },
};
