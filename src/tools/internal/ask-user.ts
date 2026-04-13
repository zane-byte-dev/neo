/**
 * ask-user.ts — Request clarification or missing information from the user.
 *
 * This tool signals to the LLM that it should stop and ask the user a question
 * before continuing. The tool returns a formatted prompt that the LLM should
 * present to the user as-is. The user's next message is the answer.
 *
 * This is a "soft pause" — the LLM must respect the returned instruction
 * and relay the question to the user instead of continuing autonomously.
 */
import type { Tool } from '../_base.js';

export const askUserTool: Tool = {
    meta: { category: 'utility', version: '1.0.0' },
    declaration: {
        name: 'ask_user',
        description:
            '向用户提问以获取缺失信息或确认操作。当你不确定用户意图、需要在多个选项间选择、' +
            '或执行高风险操作前需要确认时，应使用此工具。\n' +
            '调用后你必须立即将问题原样转达给用户，等待用户回复后再继续。',
        parameters: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                    description: '要问用户的问题，应简洁清晰',
                },
                options: {
                    type: 'string',
                    description:
                        '可选：JSON 字符串数组，提供预定义选项供用户选择。例如: ["选项A","选项B","选项C"]',
                },
                context: {
                    type: 'string',
                    description: '可选：问题的背景说明，帮助用户理解为什么要问这个问题',
                },
            },
            required: ['question'],
        },
    },

    handler: async (args) => {
        const question = String(args.question ?? '').trim();
        if (!question) return '[Error] question is required';

        const parts: string[] = [];

        if (args.context) {
            parts.push(`背景：${String(args.context).trim()}`);
        }

        parts.push(`❓ ${question}`);

        if (args.options) {
            try {
                const options = JSON.parse(String(args.options));
                if (Array.isArray(options) && options.length > 0) {
                    const optionLines = options.map((o: string, i: number) => `  ${i + 1}. ${o}`);
                    parts.push(`\n可选项：\n${optionLines.join('\n')}`);
                }
            } catch {
                // ignore malformed options
            }
        }

        parts.push('\n⏸️ [等待用户回复] 请将以上问题原样转达给用户，不要自行猜测答案。');

        return parts.join('\n');
    },
};
