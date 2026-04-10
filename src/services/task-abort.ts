/**
 * task-abort.ts — Per-sessionId AbortController registry.
 *
 * Allows an in-flight agent task to be cancelled from outside
 * (e.g. the /stop command) by aborting its fetch signal.
 */

const activeControllers = new Map<string, { controller: AbortController; registeredAt: number }>();

/** Auto-cleanup stale entries older than 1 hour */
const STALE_MS = 60 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of activeControllers) {
        if (now - entry.registeredAt > STALE_MS) {
            entry.controller.abort();
            activeControllers.delete(id);
        }
    }
}, 5 * 60 * 1000);

export function registerAbort(sessionId: string, controller: AbortController): void {
    activeControllers.set(sessionId, { controller, registeredAt: Date.now() });
}

export function unregisterAbort(sessionId: string): void {
    activeControllers.delete(sessionId);
}

/**
 * Abort the active task for a sessionId.
 * Returns true if a task was found and aborted, false if nothing was running.
 */
export function abortActiveTask(sessionId: string): boolean {
    const entry = activeControllers.get(sessionId);
    if (!entry) return false;
    entry.controller.abort();
    activeControllers.delete(sessionId);
    return true;
}

export function hasActiveTask(sessionId: string): boolean {
    return activeControllers.has(sessionId);
}
