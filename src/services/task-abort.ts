/**
 * task-abort.ts — Per-chatId AbortController registry.
 *
 * Allows an in-flight agent task to be cancelled from outside
 * (e.g. the /stop command) by aborting its fetch signal.
 */

const activeControllers = new Map<string, AbortController>();

export function registerAbort(chatId: string, controller: AbortController): void {
    activeControllers.set(chatId, controller);
}

export function unregisterAbort(chatId: string): void {
    activeControllers.delete(chatId);
}

/**
 * Abort the active task for a chatId.
 * Returns true if a task was found and aborted, false if nothing was running.
 */
export function abortActiveTask(chatId: string): boolean {
    const controller = activeControllers.get(chatId);
    if (!controller) return false;
    controller.abort();
    activeControllers.delete(chatId);
    return true;
}

export function hasActiveTask(chatId: string): boolean {
    return activeControllers.has(chatId);
}
