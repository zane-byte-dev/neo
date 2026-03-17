import { tryHandleCoreCommand } from '../commands/core-commands.js';
import { tryHandleConversationCommand } from '../commands/conversation-commands.js';
import { tryHandleTaskCommand } from '../commands/task-commands.js';
import { tryHandleReminderCommand } from '../commands/reminder-commands.js';
import { tryHandleProfileCommand } from '../commands/profile-commands.js';
import { tryHandleWorkspaceCommand } from '../commands/workspace-commands.js';

interface CommandDeps {
    bot: any;
    chatHistoryCache: any;
    asyncTaskManager: any;
    reminderManager: any;
    scheduledTaskManager: any;
    userProfile: any;
    pendingReadMatches: Map<number, { matches: string[]; expiry: number }>;
    findFiles: (query: string, baseDir: string, resolvedBase: string) => Promise<string[]>;
}

export async function handleCommand(deps: CommandDeps, ctx: any) {
    const text = ctx.message.text as string;
    const [command] = text.split(' ');

    console.log(`[Command] Received: ${command}`);

    if (await tryHandleCoreCommand(command, ctx, { chatHistoryCache: deps.chatHistoryCache })) {
        return;
    }
    if (await tryHandleConversationCommand(command, ctx, {
        bot: deps.bot,
        chatHistoryCache: deps.chatHistoryCache,
    })) {
        return;
    }
    if (await tryHandleTaskCommand(command, text, ctx, {
        asyncTaskManager: deps.asyncTaskManager,
    })) {
        return;
    }
    if (await tryHandleReminderCommand(command, text, ctx, {
        reminderManager: deps.reminderManager,
        scheduledTaskManager: deps.scheduledTaskManager,
    })) {
        return;
    }
    if (await tryHandleProfileCommand(command, text, ctx, {
        userProfile: deps.userProfile,
    })) {
        return;
    }
    if (await tryHandleWorkspaceCommand(command, text, ctx, {
        bot: deps.bot,
        pendingReadMatches: deps.pendingReadMatches,
        findFiles: deps.findFiles,
    })) {
        return;
    }

    await ctx.reply('Unknown command. Try /start for help.');
}
