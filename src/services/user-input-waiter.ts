/**
 * user-input-waiter.ts — Promise-based pause/resume for ask_user tool.
 *
 * When AI calls ask_user:
 *   1. The tool registers a pending promise here.
 *   2. message-router intercepts the user's next message and calls resolve().
 *   3. The agent loop resumes with the user's answer.
 */

interface PendingAsk {
    resolve: (answer: string) => void;
    reject: (err: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingAsk>();

const ASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Wait for user input. Returns a Promise that resolves when the user replies.
 * Rejects after ASK_TIMEOUT_MS if no reply.
 */
export function waitForUserInput(chatId: string): Promise<string> {
    // Cancel any existing pending ask for this chat
    cancel(chatId);

    return new Promise<string>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            pending.delete(chatId);
            reject(new Error('ask_user timed out — user did not respond within 5 minutes.'));
        }, ASK_TIMEOUT_MS);

        pending.set(chatId, { resolve, reject, timeoutHandle });
    });
}

/** Called by message-router when user sends a message while ask_user is pending. */
export function resolve(chatId: string, answer: string): boolean {
    const entry = pending.get(chatId);
    if (!entry) return false;
    clearTimeout(entry.timeoutHandle);
    pending.delete(chatId);
    entry.resolve(answer);
    return true;
}

/** Check if there is a pending ask for this chatId. */
export function hasPending(chatId: string): boolean {
    return pending.has(chatId);
}

/** Cancel a pending ask (e.g. on /new or /clear). */
export function cancel(chatId: string): void {
    const entry = pending.get(chatId);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    pending.delete(chatId);
    entry.reject(new Error('ask_user cancelled.'));
}
