/**
 * tool-context.ts — Shared runtime context for tools that need access to bot managers.
 *
 * Populated once during bot initialization (telegram-bot.ts), then read by tools
 * that need access to ScheduledTaskManager, ReminderManager, or the bot instance.
 */

interface ToolContext {
    scheduledTaskManager: any;
    reminderManager: any;
    bot: any;
    /** The authorized Telegram chat ID for single-user bots. */
    chatId: number;
}

let _ctx: ToolContext | null = null;

export function setToolContext(ctx: ToolContext): void {
    _ctx = ctx;
}

export function getToolContext(): ToolContext {
    if (!_ctx) throw new Error('[ToolContext] Not initialized — call setToolContext() during bot startup.');
    return _ctx;
}

/** Update just the chatId (e.g. after a message is received). */
export function setActiveChatId(chatId: number): void {
    if (_ctx) _ctx.chatId = chatId;
}
