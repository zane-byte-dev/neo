/**
 * src/routes/secrets.ts — UI-managed credentials API.
 *
 * GET  /api/secrets — return masked status for each known secret.
 * POST /api/secrets — update one or more secrets in the encrypted store.
 *                     Empty string clears an entry (falls back to env).
 *
 * Updating TELEGRAM_BOT_TOKEN triggers a Telegram bot restart so the new
 * token takes effect immediately.
 */

import type Router from '@koa/router';
import { getSecretsStatus, SECRET_KEYS, updateSecrets, type SecretKey } from '../services/secrets.js';
import { stopTelegramBot, syncTelegramBotState } from '../services/telegram-runtime.js';

function asString(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined;
}

export function secrets(router: Router): void {
    router.get('/api/secrets', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        ctx.body = { secrets: await getSecretsStatus() };
    });

    router.post('/api/secrets', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        const body = ctx.request.body as Record<string, unknown> | undefined;
        if (!body || typeof body !== 'object') {
            ctx.status = 400;
            ctx.body = { error: 'Body must be an object of { KEY: value }' };
            return;
        }

        const patch: Record<string, string> = {};
        let touchedTelegram = false;
        for (const key of SECRET_KEYS as readonly SecretKey[]) {
            if (!(key in body)) continue;
            const v = asString(body[key]);
            if (v === undefined) continue;
            patch[key] = v;
            if (key === 'TELEGRAM_BOT_TOKEN') touchedTelegram = true;
        }

        await updateSecrets(patch);

        // If the Telegram token changed, restart the bot so the new token is used.
        if (touchedTelegram) {
            stopTelegramBot();
            await syncTelegramBotState().catch(() => {/* surfaced via /api/preferences */});
        }

        ctx.body = { secrets: await getSecretsStatus() };
    });
}
