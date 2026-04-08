/**
 * tool-context.ts — Multi-tenant runtime context registry.
 *
 * Each tenant (platform:userId) gets their own isolated context with
 * independent managers, cache directories, and adapter reference.
 *
 * Context is threaded explicitly via ToolContext parameters — no global state.
 */

import type { TenantKey, PlatformAdapter } from '../types/platform.js';

export interface TenantContext {
    tenantKey: TenantKey;
    chatId: string;
    adapter: PlatformAdapter;
    scheduledTaskManager: any;
    reminderManager: any;
    chatHistoryCache: any;
    userProfile: any;
    asyncTaskManager: any;
    messageQueue: any;
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

/** Remove a tenant context (for cleanup / testing). */
export function removeTenantContext(tenantKey: TenantKey): void {
    _registry.delete(tenantKey);
}
