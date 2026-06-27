import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../retry.js';

describe('withRetry', () => {
    it('returns the value on first success', async () => {
        const fn = vi.fn(async () => 'ok');
        expect(await withRetry(fn)).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure up to `retries` times then resolves', async () => {
        let n = 0;
        const fn = vi.fn(async () => {
            n++;
            if (n < 3) throw new Error('transient');
            return 'eventual';
        });
        const onRetry = vi.fn();
        const result = await withRetry(fn, { retries: 3, baseMs: 1, onRetry });
        expect(result).toBe('eventual');
        expect(fn).toHaveBeenCalledTimes(3);
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('re-throws last error after exhausting retries', async () => {
        const fn = vi.fn(async () => { throw new Error('boom'); });
        await expect(withRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow('boom');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry when isRetryable returns false', async () => {
        const fn = vi.fn(async () => { throw Object.assign(new Error('4xx'), { status: 404 }); });
        const isRetryable = (err: unknown) => {
            const e = err as { status?: number };
            return !(typeof e?.status === 'number' && e.status < 500);
        };
        await expect(withRetry(fn, { retries: 3, baseMs: 1, isRetryable })).rejects.toThrow('4xx');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
