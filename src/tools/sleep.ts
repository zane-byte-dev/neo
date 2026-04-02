/**
 * sleep.ts — Deliberate pause tool.
 *
 * Allows the AI to wait between operations (e.g. polling, rate-limit cooldown).
 * Max sleep: 30 seconds.
 */
import type { Tool } from './_base.js';

export const sleepTool: Tool = {
    meta: { category: 'utility', version: '1.0.0' },
    declaration: {
        name: 'sleep',
        description:
            '暂停指定秒数，然后继续执行。用于等待操作完成、API 冷却或轮询间隔。最长 30 秒。',
        parameters: {
            type: 'object',
            properties: {
                seconds: {
                    type: 'number',
                    description: '等待秒数（1–30）',
                },
                reason: {
                    type: 'string',
                    description: '等待原因（可选，用于日志）',
                },
            },
            required: ['seconds'],
        },
    },
    handler: async (args, _workDir) => {
        const raw = Number(args.seconds ?? 1);
        const seconds = Math.max(1, Math.min(30, raw));
        const reason = args.reason ? ` (${String(args.reason)})` : '';
        console.log(`[SleepTool] Sleeping ${seconds}s${reason}`);
        await new Promise<void>(resolve => setTimeout(resolve, seconds * 1000));
        return `已等待 ${seconds} 秒${reason}，继续执行。`;
    },
};
