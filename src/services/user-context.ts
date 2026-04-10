/**
 * user-context.ts — Per-user shared context registry.
 *
 * A User represents a person who may connect via multiple clients (Telegram, Web, etc.).
 * Each User has exactly one workspace directory and shared managers for:
 *   - User profile
 *   - Reminders (broadcast to all connected clients)
 *   - Scheduled tasks (broadcast to all connected clients)
 *
 * Per-client (TenantContext) items like chat history and message queue
 * remain isolated — see tool-context.ts.
 */

import type { UserId } from '../types/platform.js';
import type { SkillRegistry } from '../skills/skill-registry.js';

export interface UserContext {
    userId: UserId;
    /** Per-user workspace root directory (absolute path) */
    workDir: string;
    /** Per-user system instruction (loaded from workspace config/) */
    systemInstruction: string;
    /** Shared managers — initialized in app.ts */
    userProfile: any;
    /** Per-user skill registry, populated from space/{userId}/skills/ */
    skillRegistry: SkillRegistry;
}

const _registry = new Map<UserId, UserContext>();

/** Register a user context. Called during app init for each user in users.json. */
export function registerUserContext(ctx: UserContext): void {
    _registry.set(ctx.userId, ctx);
    console.log(`[UserContext] Registered: ${ctx.userId} → ${ctx.workDir}`);
}

/** Get a user's shared context. Throws if not registered. */
export function getUserContext(userId: UserId): UserContext {
    const ctx = _registry.get(userId);
    if (!ctx) throw new Error(`[UserContext] No context for user: ${userId}`);
    return ctx;
}

/** Check if a user is registered. */
export function hasUserContext(userId: UserId): boolean {
    return _registry.has(userId);
}

/** Get all registered user IDs. */
export function getAllUserIds(): UserId[] {
    return [..._registry.keys()];
}

/** Remove a user context (for cleanup / testing). */
export function removeUserContext(userId: UserId): void {
    _registry.delete(userId);
}
