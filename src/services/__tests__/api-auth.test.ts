import { describe, it, expect } from 'vitest';
import type { ConfigUser } from '../../config.js';
import { hasApiTokenSync, matchesApiTokenSync } from '../api-auth.js';

function user(overrides: Partial<ConfigUser> = {}): ConfigUser {
    return { id: 'u1', name: 'User', ...overrides };
}

describe('api token auth', () => {
    it('reports configured when apiToken is set', () => {
        expect(hasApiTokenSync(user({ apiToken: 'my-token' }))).toBe(true);
    });

    it('reports not configured when apiToken is absent', () => {
        expect(hasApiTokenSync(user())).toBe(false);
        expect(hasApiTokenSync(user({ apiToken: null }))).toBe(false);
        expect(hasApiTokenSync(user({ apiToken: '  ' }))).toBe(false);
    });

    it('matches correct token with timing-safe comparison', () => {
        const cfg = user({ apiToken: 'my-secret-token' });
        expect(matchesApiTokenSync(cfg, 'my-secret-token')).toBe(true);
        expect(matchesApiTokenSync(cfg, 'wrong-token')).toBe(false);
        expect(matchesApiTokenSync(cfg, '')).toBe(false);
    });

    it('rejects all tokens when apiToken is not configured', () => {
        expect(matchesApiTokenSync(user(), 'any-token')).toBe(false);
    });
});
