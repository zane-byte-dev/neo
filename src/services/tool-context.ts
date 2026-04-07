/**
 * tool-context.ts — Multi-tenant runtime context registry.
 *
 * Each tenant (platform:userId) gets their own isolated context with
 * independent managers, cache directories, and adapter reference.
 *
 * Tools call `getToolContext()` (uses active tenant) or
 * `getTenantContext(tenantKey)` for explicit access.
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
    cacheDir: string;
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

// ── Active tenant pointer (set per-message in the router) ────────────────────

let _activeTenantKey: TenantKey | null = null;

export function setActiveTenantKey(tenantKey: TenantKey): void {
    _activeTenantKey = tenantKey;
}

export function getActiveTenantKey(): TenantKey | null {
    return _activeTenantKey;
}

/**
 * Legacy-compatible: get tool context for the currently active tenant.
 * Prefer getTenantContext(tenantKey) in new code.
 */
export function getToolContext(): TenantContext {
    if (!_activeTenantKey) throw new Error('[ToolContext] No active tenant. Call setActiveTenantKey() first.');
    return getTenantContext(_activeTenantKey);
}

/** @deprecated Use setActiveTenantKey instead */
export function setActiveChatId(_chatId: number): void {
    // no-op — kept for compilation compatibility during migration
}

/** @deprecated Use registerTenantContext instead */
export function setToolContext(_ctx: any): void {
    // no-op — kept for compilation compatibility during migration
}
