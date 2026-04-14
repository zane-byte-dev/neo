/**
 * user-service.ts — Business logic for the users table + per-user runtime context.
 *
 * Also owns the per-user UserContext registry:
 *   calcUser(userId)  — build and cache the full runtime context for a user.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { UserProfileManager } from './user-profile.js';
import { loadUserSkills } from '../skills/skill-registry.js';
import { loadUserTools } from '../tools/user-tools/loader.js';
import { buildTenantSystemInstruction } from '../llm/client.js';
import { resolveUserWorkspaceDir } from '../utils/workspace.js';
import type { UserId } from '../types/platform.js';
import type { SkillRegistry } from '../skills/skill-registry.js';
import type { Tool } from '../llm/types.js';

export interface UserRow {
    id: string;
    name: string;
    workspace: string;
    tenants: string[];
    web_token: string | null;
}

export function userList(): UserRow[] {
    return _readConfigUsers().map((u) => ({
        id: u.id,
        name: u.name,
        workspace: u.workspace,
        tenants: u.tenants ?? [],
        web_token: u.webToken ?? null,
    }));
}

export function userGetByTenant(tenantKey: string): UserRow | null {
    const users = _readConfigUsers();
    const user = users.find((u) => (u.tenants ?? []).includes(tenantKey));
    if (!user) return null;
    return {
        id: user.id,
        name: user.name,
        workspace: user.workspace,
        tenants: user.tenants ?? [],
        web_token: user.webToken ?? null,
    };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const _projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const _spaceDir    = resolve(_projectRoot, 'space');
const _configPath  = resolve(_spaceDir, 'config.json');

interface ConfigUser {
    id: string;
    name: string;
    workspace: string;
    tenants?: string[];
    webToken?: string | null;
}

function _readConfigUsers(): ConfigUser[] {
    try {
        const raw = readFileSync(_configPath, 'utf8');
        const data = JSON.parse(raw) as { users?: ConfigUser[] };
        return data.users ?? [];
    } catch {
        return [];
    }
}

/** Get a user by web token. */
export function userGetByWebToken(token: string): UserRow | null {
    const users = _readConfigUsers();
    const u = users.find(u => u.webToken === token);
    if (!u) return null;
    return {
        id:        u.id,
        name:      u.name,
        workspace: u.workspace,
        tenants:   u.tenants ?? [],
        web_token: u.webToken ?? null,
    };
}

// ── Per-user runtime context ──────────────────────────────────────────────────

export interface UserContext {
    userId: UserId;
    /** Per-user workspace root directory (absolute path) */
    workDir: string;
    /** Per-user system instruction (loaded from workspace config/) */
    systemInstruction: string;
    /** File-based user profile manager */
    userProfile: UserProfileManager;
    /** Per-user skill registry, populated from space/{userId}/skills/ */
    skillRegistry: SkillRegistry;
    /** Per-user tools loaded from space/{userId}/.tools/ */
    userTools: Map<string, Tool>;
}

const _contextCache = new Map<UserId, UserContext>();

/**
 * Build the full runtime context for a user and cache it.
 *
 * Returns the cached instance on subsequent calls unless `force = true`.
 * The workspace is resolved from space/{userId}/ automatically.
 */
export async function calcUser(userId: UserId, force = false): Promise<UserContext> {
    if (!force && _contextCache.has(userId)) {
        return _contextCache.get(userId)!;
    }

    const workDir = resolveUserWorkspaceDir(_spaceDir, userId);

    const [systemInstruction, skillRegistry, userTools] = await Promise.all([
        buildTenantSystemInstruction(workDir),
        loadUserSkills(userId, _projectRoot),
        loadUserTools(workDir),
    ]);

    const userProfile = new UserProfileManager(workDir);
    await userProfile.init();

    const ctx: UserContext = { userId, workDir, systemInstruction, userProfile, skillRegistry, userTools };
    _contextCache.set(userId, ctx);
    return ctx;
}
