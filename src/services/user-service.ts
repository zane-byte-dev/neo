/**
 * user-service.ts — Business logic for the users table + per-user runtime context.
 *
 * Mirrors the structure of space/config.json and provides a single source
 * of truth at runtime via SQLite (fast lookups, cross-service joins).
 *
 * Also owns the per-user UserContext registry (previously user-context.ts):
 *   calcUser(userId)  — build and cache the full runtime context for a user.
 *
 * Call syncUsersFromConfig() once at startup to populate/refresh the table.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { UserProfileManager } from './user-profile.js';
import { loadUserSkills } from '../skills/skill-registry.js';
import { buildTenantSystemInstruction } from '../llm/client.js';
import { resolveUserWorkspaceDir } from '../utils/workspace.js';
import type { UserId } from '../types/platform.js';
import type { SkillRegistry } from '../skills/skill-registry.js';

export interface UserRow {
    id: string;
    name: string;
    workspace: string;
    tenants: string[];   // parsed from JSON column
    web_token: string | null;
    created_at: number;
    updated_at: number;
}

/** Shape of a single entry in space/config.json → users[] */
interface ConfigUser {
    id: number | string;
    name: string;
    workspace: string;
    tenants?: string[];
    webToken?: string;
}

// ── Config path ───────────────────────────────────────────────────────────────

const _configPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'space', 'config.json',
);

// ── Internal helpers ──────────────────────────────────────────────────────────

function _parseRow(raw: Record<string, unknown>): UserRow {
    return {
        id:         raw.id as string,
        name:       raw.name as string,
        workspace:  raw.workspace as string,
        tenants:    JSON.parse(raw.tenants as string ?? '[]') as string[],
        web_token:  (raw.web_token as string | null) ?? null,
        created_at: raw.created_at as number,
        updated_at: raw.updated_at as number,
    };
}

// ── Sync from config.json ─────────────────────────────────────────────────────

/**
 * Read space/config.json and upsert every user entry into the `users` table.
 * Existing rows are updated; new rows are inserted.
 *
 * Returns the number of users processed.
 */
export function syncUsersFromConfig(configPath = _configPath): number {
    const raw = readFileSync(configPath, 'utf8');
    const data = JSON.parse(raw) as { users?: ConfigUser[] };
    const entries: ConfigUser[] = data.users ?? [];

    const db = getDb();
    const now = Date.now();

    const upsert = db.prepare(`
        INSERT INTO users (id, name, workspace, tenants, web_token, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name       = excluded.name,
            workspace  = excluded.workspace,
            tenants    = excluded.tenants,
            web_token  = excluded.web_token,
            updated_at = excluded.updated_at
    `);

    const sync = db.transaction(() => {
        for (const u of entries) {
            upsert.run(
                String(u.id),
                u.name,
                u.workspace,
                JSON.stringify(u.tenants ?? []),
                u.webToken ?? null,
                now,
                now,
            );
        }
    });

    sync();
    console.log(`[UserService] Synced ${entries.length} user(s) from ${configPath}`);
    return entries.length;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** Get a user by their internal string ID. */
export function userGet(id: string): UserRow | null {
    const row = getDb().prepare(
        `SELECT id, name, workspace, tenants, web_token, created_at, updated_at
         FROM users WHERE id = ?`
    ).get(id);
    return row ? _parseRow(row as Record<string, unknown>) : null;
}

/** Get a user by their name field (unique in practice). */
export function userGetByName(name: string): UserRow | null {
    const row = getDb().prepare(
        `SELECT id, name, workspace, tenants, web_token, created_at, updated_at
         FROM users WHERE name = ?`
    ).get(name);
    return row ? _parseRow(row as Record<string, unknown>) : null;
}

/** Get a user by web token. */
export function userGetByWebToken(token: string): UserRow | null {
    const row = getDb().prepare(
        `SELECT id, name, workspace, tenants, web_token, created_at, updated_at
         FROM users WHERE web_token = ?`
    ).get(token);
    return row ? _parseRow(row as Record<string, unknown>) : null;
}

/** List all users. */
export function userList(): UserRow[] {
    return (getDb().prepare(
        `SELECT id, name, workspace, tenants, web_token, created_at, updated_at
         FROM users ORDER BY name ASC`
    ).all() as Record<string, unknown>[]).map(_parseRow);
}

// ── Per-user runtime context ──────────────────────────────────────────────────

const _projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const _spaceDir    = resolve(_projectRoot, 'space');

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

    const [systemInstruction, skillRegistry] = await Promise.all([
        buildTenantSystemInstruction(workDir),
        loadUserSkills(userId, _projectRoot),
    ]);

    const userProfile = new UserProfileManager(workDir);
    await userProfile.init();

    const ctx: UserContext = { userId, workDir, systemInstruction, userProfile, skillRegistry };
    _contextCache.set(userId, ctx);
    console.log(`[UserService] calcUser: ${userId} → ${workDir}`);
    return ctx;
}
