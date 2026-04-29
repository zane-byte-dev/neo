/**
 * user-service.ts — Business logic for the users table + per-user runtime context.
 *
 * Also owns the per-user UserContext registry:
 *   calcUser(userId)  — build and cache the full runtime context for a user.
 */
import { UserProfileManager } from './user-profile.js';
import { loadUserPreferences, type UserPreferences } from './user-prefs.js';
import { loadUserSkills } from '../skills/skill-registry.js';
import { loadUserTools } from '../tools/user-tools/loader.js';
import { loadMcpTools } from '../mcp/loader.js';
import { buildTenantSystemInstruction } from '../llm/client.js';
import type { UserId } from '../types/platform.js';
import type { SkillRegistry } from '../skills/skill-registry.js';
import type { Tool } from '../llm/types.js';
import { log } from '../utils/logger.js';

export interface UserRow {
    id: string;
    name: string;
    tenants: string[];
    web_token: string | null;
    workDir: string | null;
    stateDir: string | null;
}

export function userList(): UserRow[] {
    return _readConfigUsers().map((u) => ({
        id: u.id,
        name: u.name,
        tenants: u.tenants ?? [],
        web_token: u.webToken ?? null,
        workDir: u.workDir ?? null,
        stateDir: u.stateDir ?? null,
    }));
}

export function userGetByTenant(tenantKey: string): UserRow | null {
    const users = _readConfigUsers();
    const user = users.find((u) => (u.tenants ?? []).includes(tenantKey));
    if (!user) return null;
    return {
        id: user.id,
        name: user.name,
        tenants: user.tenants ?? [],
        web_token: user.webToken ?? null,
        workDir: user.workDir ?? null,
        stateDir: user.stateDir ?? null,
    };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

import { getUsersConfig, type ConfigUser } from '../config.js';

function _readConfigUsers(): ConfigUser[] {
    return getUsersConfig();
}

/** Get the webhook secret for a user (from USERS env var). */
export function getWebhookSecret(userId: string): string | null {
    return _readConfigUsers().find(u => u.id === userId)?.webhookSecret ?? null;
}

/** Get the absolute workspace directory for a user (from USERS env var). */
export function userGetWorkspaceDir(userId: string): string | null {
    return _readConfigUsers().find((u) => u.id === userId)?.workDir ?? null;
}

/** Get the absolute state directory for a user (from USERS env var). */
export function userGetStateDir(userId: string): string | null {
    return _readConfigUsers().find((u) => u.id === userId)?.stateDir ?? null;
}

/** Backward-compatible alias for the workspace directory. */
export function userGetWorkDir(userId: string): string | null {
    return userGetWorkspaceDir(userId);
}

/** Get a user by web token. */
export function userGetByWebToken(token: string): UserRow | null {
    const users = _readConfigUsers();
    const u = users.find(u => u.webToken === token);
    if (!u) return null;
    return {
        id:        u.id,
        name:      u.name,
        tenants:   u.tenants ?? [],
        web_token: u.webToken ?? null,
        workDir: u.workDir ?? null,
        stateDir: u.stateDir ?? null,
    };
}

export interface UserContext {
    userId: UserId;
    /** Per-user workspace root directory (absolute path). */
    workDir: string;
    /** Per-user runtime/state directory (absolute path). */
    stateDir: string;
    /** Per-user system instruction (loaded from workspace config/) */
    systemInstruction: string;
    /** File-based user profile manager */
    userProfile: UserProfileManager;
    /** Per-user skill registry, populated from stateDir/skills/ */
    skillRegistry: SkillRegistry;
    /** Per-user tools loaded from stateDir/tools/ */
    userTools: Map<string, Tool>;
    /** Per-user runtime preferences (default model, enabled models, …) */
    preferences: UserPreferences;
}

const _contextCache = new Map<UserId, UserContext>();

/**
 * Force-refresh the cached context for a user.
 * Call after editing config files (AGENTS.md, SOUL.md in workDir; skills/, tools/ in stateDir).
 */
export function invalidateUserCache(userId?: UserId): void {
    if (userId) {
        _contextCache.delete(userId);
        log.info('UserService', `Cache invalidated for user: ${userId}`);
    } else {
        _contextCache.clear();
        log.info('UserService', 'Cache invalidated for all users');
    }
}

/**
 * Build the full runtime context for a user and cache it.
 *
 * Returns the cached instance on subsequent calls unless `force = true`.
 * Workspace data lives under workDir; runtime state lives under stateDir.
 */
export async function calcUser(userId: UserId, force = false): Promise<UserContext> {
    if (!force && _contextCache.has(userId)) {
        return _contextCache.get(userId)!;
    }

    const workDir = userGetWorkspaceDir(userId);
    if (!workDir) throw new Error(`No workDir configured for user "${userId}"`);
    const stateDir = userGetStateDir(userId);
    if (!stateDir) throw new Error(`No stateDir configured for user "${userId}"`);

    const [systemInstruction, skillRegistry, userTools, mcpTools, preferences] = await Promise.all([
        buildTenantSystemInstruction(workDir),
        loadUserSkills(stateDir, userId),
        loadUserTools(stateDir),
        loadMcpTools(workDir),
        loadUserPreferences(stateDir),
    ]);

    // Merge MCP tools into userTools (later tools win on name clash, but the
    // mcp__ prefix makes collisions extremely unlikely).
    for (const [name, tool] of mcpTools) {
        userTools.set(name, tool);
    }

    const userProfile = new UserProfileManager(workDir);
    await userProfile.init();

    const ctx: UserContext = {
        userId,
        workDir,
        stateDir,
        systemInstruction,
        userProfile,
        skillRegistry,
        userTools,
        preferences,
    };
    _contextCache.set(userId, ctx);
    return ctx;
}
