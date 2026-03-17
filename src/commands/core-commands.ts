import type { Command } from './_base.js';

export const coreCommand: Command = {
    commands: ['/start', '/clear', '/new', '/stats'],
    handler: async (command, _text, ctx, deps) => {
    switch (command) {
        case '/start':
            await ctx.reply(
                '🔭 **inkClaw Connect Gateway**\n' +
                '这是一个极简的全能代理网关。\n\n' +
                '**对话控制**\n' +
                '`/new` — 开启新会话（重置上下文）\n' +
                '`/compact` — 压缩当前上下文（保留摘要）\n' +
                '`/clear` — 清空全部历史\n' +
                '`/btw <问题>` — 临时问答，不计入上下文\n' +
                '`/stats` — 查看会话统计\n\n' +
                '**任务管理**\n' +
                '`/tasks` — 查看后台任务\n' +
                '`/cancel <id>` — 取消任务\n' +
                '`/async` 或 `/research` — 提交后台长任务\n\n' +
                '**提醒 & 定时**\n' +
                '`/reminders` — 查看提醒\n' +
                '`/schedules` — 查看定时任务\n\n' +
                '**文件直通（零 token）**\n' +
                '`/ls [路径]` — 列出 workspace 目录内容\n' +
                '`/read <路径>` — 直接读取文件内容，不经过 AI\n' +
                '`/note <内容>` — 快速追加碎片到今日 Inbox\n' +
                '`/today` — 查看今日 Inbox 与日记\n' +
                '`/task <内容>` — 快速追加任务到 2-Tasks\n' +
                '`/search <关键词>` — 全文搜索 vault\n' +
                '`/weekly` — 立即生成本周周报',
                { parse_mode: 'Markdown' }
            );
            return true;

        case '/clear':
            await deps.chatHistoryCache.clearHistory();
            await ctx.reply('🗑️ Chat history cleared. Starting fresh!');
            return true;

        case '/new':
            await deps.chatHistoryCache.createNewSession();
            await ctx.reply('📝 新会话已开启，上下文已重置。');
            return true;

        case '/stats': {
            const stats = deps.chatHistoryCache.getStats();
            await ctx.reply(
                `📊 **Chat Statistics**\n` +
                `Total sessions: ${stats.totalSessions}\n` +
                `Current messages: ${stats.currentMessages}\n` +
                `Session ID: ${stats.sessionId || 'N/A'}`
            );
            return true;
        }

        default:
            return false;
    }
    },
};
