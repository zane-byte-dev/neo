/**
 * pending-confirm.ts — In-memory registry of pending tool-confirmation requests.
 *
 * Used by the chat SSE handler to bridge between:
 *   - server-side `confirmCallback` which awaits a boolean
 *   - client-side approve/deny UI which POSTs to /api/tool-confirm
 *
 * Entries are scoped per-userId and auto-deny after a timeout so a hung
 * client cannot wedge the agent.
 */

import { generateId } from './id-generator.js';

interface Pending {
    userId: string;
    resolve: (approved: boolean) => void;
    timer: NodeJS.Timeout;
}

const _pending = new Map<string, Pending>();

/** Default wait time before auto-deny. */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;

export interface CreateConfirmResult {
    confirmId: string;
    /** Resolves with the user's decision, or `false` on timeout/abort. */
    promise: Promise<boolean>;
}

export function createConfirm(
    userId: string,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): CreateConfirmResult {
    const confirmId = generateId();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
    let settle!: (approved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { settle = resolve; });

    const timer = setTimeout(() => {
        if (_pending.delete(confirmId)) settle(false);
    }, timeoutMs);

    _pending.set(confirmId, {
        userId,
        resolve: (approved) => {
            clearTimeout(timer);
            settle(approved);
        },
        timer,
    });

    if (opts.signal) {
        const onAbort = () => {
            const entry = _pending.get(confirmId);
            if (entry) {
                _pending.delete(confirmId);
                entry.resolve(false);
            }
        };
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    return { confirmId, promise };
}

/**
 * Resolve a pending confirmation. Returns true when a matching pending entry
 * was found and the caller owned it. Returns false on mismatch (unknown id,
 * wrong user, already resolved).
 */
export function resolveConfirm(
    confirmId: string,
    userId: string,
    approved: boolean,
): boolean {
    const entry = _pending.get(confirmId);
    if (!entry) return false;
    if (entry.userId !== userId) return false;
    _pending.delete(confirmId);
    entry.resolve(approved);
    return true;
}

/** Test helper. */
export function _resetPending(): void {
    for (const [, entry] of _pending) clearTimeout(entry.timer);
    _pending.clear();
}
