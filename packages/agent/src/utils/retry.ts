/**
 * retry.ts — Tiny exponential-backoff retry helper.
 *
 * Used by network-bound tools (fetch-url, search-web) so transient failures
 * don't bubble back to the model. Intentionally dependency-free.
 */

export interface RetryOptions<T> {
    /** Number of retry attempts after the initial try. Default 2. */
    retries?: number;
    /** Base delay in ms for the first retry; doubles each iteration. Default 300. */
    baseMs?: number;
    /** Cap on any single wait. Default 5000. */
    maxMs?: number;
    /** Predicate to decide whether an error/result is retryable. */
    isRetryable?: (errOrResult: unknown, attempt: number) => boolean;
    /** Abort signal — cancels between retries. */
    signal?: AbortSignal;
    /** Optional log hook. */
    onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(), ms);
        if (signal) {
            const onAbort = () => {
                clearTimeout(timer);
                reject(new Error('Aborted'));
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

/**
 * Run `fn` with exponential backoff. Only thrown errors are retried.
 * Returns the successful value, or re-throws the last error.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: RetryOptions<T> = {},
): Promise<T> {
    const retries = opts.retries ?? 2;
    const baseMs = opts.baseMs ?? 300;
    const maxMs = opts.maxMs ?? 5_000;
    const isRetryable = opts.isRetryable ?? (() => true);

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt === retries || !isRetryable(err, attempt)) throw err;
            const delay = Math.min(maxMs, baseMs * 2 ** attempt);
            opts.onRetry?.(err, attempt + 1, delay);
            await sleep(delay, opts.signal);
        }
    }
    throw lastError;
}
