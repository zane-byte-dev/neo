/**
 * src/routes/preferences.ts — Per-user runtime preferences API.
 *
 * GET  /api/preferences — return the current user's stored preferences.
 * POST /api/preferences — persist the provided preferences and invalidate
 *                         the cached UserContext.
 */

import type Router from '@koa/router';
import { calcUser, invalidateUserCache } from '../services/user-service.js';
import { saveUserPreferences, type UserPreferences } from '../services/user-prefs.js';
import { MODEL_ALIASES } from '../config.js';
import { isModelAliasAvailable } from '../llm/model-router.js';

function sanitizeIncoming(body: unknown): UserPreferences {
    const out: UserPreferences = {};
    if (!body || typeof body !== 'object') return out;
    const b = body as Record<string, unknown>;

    if (typeof b.defaultModel === 'string') {
        const m = b.defaultModel.trim();
        if (m && (m === 'auto' || MODEL_ALIASES[m])) {
            // 'auto' clears the preference; anything else must be a known alias.
            if (m !== 'auto') out.defaultModel = m;
        }
    }
    if (Array.isArray(b.enabledModels)) {
        const list = b.enabledModels
            .filter((m): m is string => typeof m === 'string')
            .map((m) => m.trim())
            .filter((m) => m && MODEL_ALIASES[m]);
        if (list.length) out.enabledModels = [...new Set(list)];
    }
    return out;
}

export function preferences(router: Router): void {
    router.get('/api/preferences', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        const userCtx = await calcUser(userId);
        ctx.body = {
            preferences: userCtx.preferences,
            availableModels: Object.keys(MODEL_ALIASES).filter((alias) => isModelAliasAvailable(alias)),
        };
    });

    router.post('/api/preferences', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        const incoming = sanitizeIncoming(ctx.request.body);
        const userCtx = await calcUser(userId);
        const saved = await saveUserPreferences(userCtx.stateDir ?? userCtx.workDir, incoming);
        invalidateUserCache(userId);
        ctx.body = { preferences: saved };
    });
}
