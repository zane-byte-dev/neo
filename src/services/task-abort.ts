/**
 * task-abort.ts — Per-sessionId AbortController registry.
 *
 * Allows an in-flight agent task to be cancelled from outside
 * (e.g. the /stop command) by aborting its fetch signal.
 */

const activeControllers = new Map<string, AbortController>();

export function registerAbort(sessionId: string, controller: AbortController): void {
    activeControllers.set(sessionId, controller);
}

export function unregisterAbort(sessionId: string): void {
    activeControllers.delete(sessionId);
}

/**
 * Abort the active task for a sessionId.
 * Returns true if a task was found and aborted, false if nothing was running.
 */
export function abortActiveTask(sessionId: string): boolean {
    const controller = activeControllers.get(sessionId);
    if (!controller) return false;
    controller.abort();
    activeControllers.delete(sessionId);
    return true;
}

export function hasActiveTask(sessionId: string): boolean {
    return activeControllers.has(sessionId);
}
