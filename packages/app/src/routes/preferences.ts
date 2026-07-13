/**
 * src/routes/preferences.ts — Per-user runtime preferences API.
 *
 * GET  /api/preferences — return the current user's stored preferences.
 * POST /api/preferences — persist the provided preferences and invalidate
 *                         the cached UserContext.
 */

import type Router from '@koa/router';
import { calcUser, invalidateUserCache } from '@neo/agent/services/user-service.js';
import { saveUserPreferences, type UserPreferences } from '@neo/agent/services/user-prefs.js';

const CONFIGURED_PI_MODELS = (process.env.NEO_PI_MODELS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

function isSelectablePiModel(model: string): boolean {
    return CONFIGURED_PI_MODELS.length === 0 || CONFIGURED_PI_MODELS.includes(model);
}

export interface PreferencesRouteDeps {
    calcUser: typeof calcUser;
    invalidateUserCache: typeof invalidateUserCache;
    saveUserPreferences: typeof saveUserPreferences;
    availableModelAliases: readonly string[];
    isSelectableModelAlias: (model: string) => boolean;
}

const defaultDeps: PreferencesRouteDeps = {
    calcUser,
    invalidateUserCache,
    saveUserPreferences,
    availableModelAliases: CONFIGURED_PI_MODELS,
    isSelectableModelAlias: isSelectablePiModel,
};

function sanitizeIncoming(body: unknown, isSelectable: (model: string) => boolean): UserPreferences {
    const out: UserPreferences = {};
    if (!body || typeof body !== 'object') return out;
    const b = body as Record<string, unknown>;

    if (typeof b.defaultModel === 'string') {
        const m = b.defaultModel.trim();
        if (m && (m === 'auto' || isSelectable(m))) {
            // 'auto' clears the preference; anything else must be a known alias.
            if (m !== 'auto') out.defaultModel = m;
        }
    }
    if (Array.isArray(b.enabledModels)) {
        const list = b.enabledModels
            .filter((m): m is string => typeof m === 'string')
            .map((m) => m.trim())
            .filter((m) => m && isSelectable(m));
        if (list.length) out.enabledModels = [...new Set(list)];
    }
    return out;
}

export function preferences(router: Router, deps: PreferencesRouteDeps = defaultDeps): void {
    router.get('/api/preferences', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        const userCtx = await deps.calcUser(userId);
        ctx.body = {
            preferences: userCtx.preferences,
            availableModels: deps.availableModelAliases,
        };
    });

    router.post('/api/preferences', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        const incoming = sanitizeIncoming(ctx.request.body, deps.isSelectableModelAlias);
        const userCtx = await deps.calcUser(userId);
        const saved = await deps.saveUserPreferences(userCtx.stateDir ?? userCtx.workDir, incoming);
        deps.invalidateUserCache(userId);
        ctx.body = { preferences: saved };
    });
}
