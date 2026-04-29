import { getTelegramBotToken } from '../config.js';
import { startTelegramBot, type TelegramRuntime } from '../platforms/telegram-bot.js';
import { log } from '../utils/logger.js';
import { loadUserPreferences } from './user-prefs.js';
import { userList } from './user-service.js';

const MODULE = 'TelegramRuntime';

let runtime: TelegramRuntime | null = null;
let startInFlight: Promise<TelegramRuntime | null> | null = null;

export interface TelegramRuntimeState {
    configured: boolean;
    active: boolean;
}

export interface TelegramStartResult extends TelegramRuntimeState {
    reason?: 'missing_token' | 'start_failed';
    error?: string;
}

export interface TelegramSyncResult extends TelegramStartResult {
    enabledByUsers: number;
}

export function getTelegramRuntime(): TelegramRuntime | null {
    return runtime;
}

export function getTelegramRuntimeState(): TelegramRuntimeState {
    return {
        configured: Boolean(getTelegramBotToken()),
        active: runtime !== null,
    };
}

export async function ensureTelegramBotStarted(): Promise<TelegramStartResult> {
    if (runtime) {
        return getTelegramRuntimeState();
    }

    if (!getTelegramBotToken()) {
        return {
            configured: false,
            active: false,
            reason: 'missing_token',
        };
    }

    if (!startInFlight) {
        startInFlight = startTelegramBot();
    }

    try {
        const started = await startInFlight;
        runtime = started;
        if (!started) {
            return {
                configured: Boolean(getTelegramBotToken()),
                active: false,
                reason: 'missing_token',
            };
        }
        log.info(MODULE, 'Bot started via runtime manager');
        return getTelegramRuntimeState();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(MODULE, 'Failed to start bot', {
            error: message,
            stack: err instanceof Error ? err.stack : undefined,
        });
        runtime = null;
        return {
            configured: true,
            active: false,
            reason: 'start_failed',
            error: message,
        };
    } finally {
        startInFlight = null;
    }
}

export async function syncTelegramBotState(): Promise<TelegramSyncResult> {
    const enabledByUsers = await countUsersWithTelegramEnabled();
    if (enabledByUsers > 0) {
        const result = await ensureTelegramBotStarted();
        return { ...result, enabledByUsers };
    }

    stopTelegramBot();
    return {
        ...getTelegramRuntimeState(),
        enabledByUsers: 0,
    };
}

export function stopTelegramBot(): void {
    if (!runtime) return;
    try {
        runtime.stop();
    } catch (err: unknown) {
        log.warn(MODULE, 'Failed to stop bot cleanly', {
            error: err instanceof Error ? err.message : String(err),
        });
    } finally {
        runtime = null;
    }
    log.info(MODULE, 'Bot stopped');
}

async function countUsersWithTelegramEnabled(): Promise<number> {
    const users = userList().filter((user) => typeof user.stateDir === 'string' && user.stateDir);
    if (users.length === 0) return 0;

    const prefsList = await Promise.all(
        users.map(async (user) => loadUserPreferences(user.stateDir as string)),
    );
    return prefsList.filter((prefs) => prefs.telegramBotEnabled === true).length;
}