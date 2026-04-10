/**
 * _base.ts — Shared types for command modules.
 */
import type { TenantKey } from '../types/platform.js';
import type { PlatformAdapter } from '../types/platform.js';
import type { SkillRegistry } from '../skills/skill-registry.js';

export interface CommandDeps {
    adapter: PlatformAdapter;
    tenantKey: TenantKey;
    chatId: string;
    /** Per-tenant workspace root directory (absolute path) */
    workDir: string;
    chatHistoryCache: any;
    asyncTaskManager: any;
    todoManager: any;
    userProfile: any;
    skillRegistry: SkillRegistry;
    pendingReadMatches: Map<string, { matches: string[]; expiry: number }>;
    findFiles: (query: string, baseDir: string, resolvedBase: string) => Promise<string[]>;
}

export interface Command {
    /** Slash commands this module handles, e.g. ['/start', '/new', '/clear'] */
    commands: string[];
    handler: (command: string, text: string, msg: { chatId: string; messageId: string; quotedText?: string }, deps: CommandDeps) => Promise<boolean>;
}
