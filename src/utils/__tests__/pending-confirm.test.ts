import { describe, it, expect, beforeEach } from 'vitest';
import { createConfirm, resolveConfirm, _resetPending } from '../pending-confirm.js';

describe('pending-confirm', () => {
    beforeEach(() => _resetPending());

    it('resolves when approved', async () => {
        const { confirmId, promise } = createConfirm('u1');
        const ok = resolveConfirm(confirmId, 'u1', true);
        expect(ok).toBe(true);
        await expect(promise).resolves.toBe(true);
    });

    it('resolves when denied', async () => {
        const { confirmId, promise } = createConfirm('u1');
        resolveConfirm(confirmId, 'u1', false);
        await expect(promise).resolves.toBe(false);
    });

    it('rejects resolution from a different user', async () => {
        const { confirmId, promise } = createConfirm('u1');
        expect(resolveConfirm(confirmId, 'u2', true)).toBe(false);
        // Still pending — approve from the owner afterwards.
        resolveConfirm(confirmId, 'u1', true);
        await expect(promise).resolves.toBe(true);
    });

    it('returns false for unknown confirmId', () => {
        expect(resolveConfirm('nope', 'u1', true)).toBe(false);
    });

    it('auto-denies on timeout', async () => {
        const { promise } = createConfirm('u1', { timeoutMs: 20 });
        await expect(promise).resolves.toBe(false);
    });

    it('auto-denies when abort signal fires', async () => {
        const ctrl = new AbortController();
        const { promise } = createConfirm('u1', { signal: ctrl.signal });
        ctrl.abort();
        await expect(promise).resolves.toBe(false);
    });

    it('cannot be resolved twice', async () => {
        const { confirmId, promise } = createConfirm('u1');
        expect(resolveConfirm(confirmId, 'u1', true)).toBe(true);
        expect(resolveConfirm(confirmId, 'u1', false)).toBe(false);
        await expect(promise).resolves.toBe(true);
    });
});
