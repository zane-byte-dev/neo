/**
 * tool-context.ts — Multi-tenant runtime context registry.
 *
 * Each tenant (platform:userId) gets their own isolated context with
 * independent chat history, message queue, and adapter reference.
 *
 * Workspace-level resources (workDir, userProfile, reminderManager,
 * scheduledTaskManager) are shared via the UserContext — see user-context.ts.
 *
 * Context is threaded explicitly via TenantContext parameters — no global state.
 */

import type { TenantKey, PlatformAdapter, UserId } from '../types/platform.js';
import type { UserContext } from './user-context.js';

export interface TenantContext {
    tenantKey: TenantKey;
    chatId: string;
    /** The owning user (from users.json) */
    userId: UserId;
    /** Shared per-user context (workspace, profile, reminders, schedules) */
    user: UserContext;

    // ── Convenience accessors (delegated to user) ────────────────────────
    /** Per-user workspace root directory (absolute path) */
    workDir: string;
    /** Per-user system instruction (loaded from workspace config/) */
    systemInstruction: string;

    // ── Per-tenant (client-specific) ─────────────────────────────────────
    adapter: PlatformAdapter;
    chatHistoryCache: any;
    asyncTaskManager: any;
    messageQueue: any;

    // ── Shared per-user managers (convenience references) ────────────────
    scheduledTaskManager: any;
    reminderManager: any;
    userProfile: any;
}

const _registry = new Map<TenantKey, TenantContext>();

/** Register a tenant context. Called during bot initialization for each authorized user. */
export function registerTenantContext(ctx: TenantContext): void {
    _registry.set(ctx.tenantKey, ctx);
    console.log(`[TenantContext] Registered: ${ctx.tenantKey}`);
}

/** Get a tenant's context. Throws if not registered. */
export function getTenantContext(tenantKey: TenantKey): TenantContext {
    const ctx = _registry.get(tenantKey);
    if (!ctx) throw new Error(`[TenantContext] No context for tenant: ${tenantKey}`);
    return ctx;
}

/** Check if a tenant is registered. */
export function hasTenantContext(tenantKey: TenantKey): boolean {
    return _registry.has(tenantKey);
}

/** Get all registered tenant keys. */
export function getAllTenantKeys(): TenantKey[] {
    return [..._registry.keys()];
}

/** Get all tenant contexts belonging to a specific user. */
export function getTenantContextsForUser(userId: UserId): TenantContext[] {
    return [..._registry.values()].filter(ctx => ctx.userId === userId);
}

/** Remove a tenant context (for cleanup / testing). */
export function removeTenantContext(tenantKey: TenantKey): void {
    _registry.delete(tenantKey);
}
