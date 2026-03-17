/**
 * _base.ts — Shared types for command modules.
 */

export interface CommandDeps {
    bot: any;
    chatHistoryCache: any;
    asyncTaskManager: any;
    reminderManager: any;
    scheduledTaskManager: any;
    userProfile: any;
    pendingReadMatches: Map<number, { matches: string[]; expiry: number }>;
    findFiles: (query: string, baseDir: string, resolvedBase: string) => Promise<string[]>;
}

export interface Command {
    /** Slash commands this module handles, e.g. ['/start', '/new', '/clear'] */
    commands: string[];
    handler: (command: string, text: string, ctx: any, deps: CommandDeps) => Promise<boolean>;
}
