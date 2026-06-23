import { describe, it, expect } from 'vitest';
import type { ConfigUser } from '../../config.js';
import { hasEffectiveGatewayTokenSync, matchesGatewayTokenSync } from '../gateway-settings.js';

function user(overrides: Partial<ConfigUser> = {}): ConfigUser {
    return { id: 'u1', name: 'User', ...overrides };
}

describe('api token auth', () => {
    it('reports configured when apiToken is set', () => {
        expect(hasEffectiveGatewayTokenSync(user({ apiToken: 'my-token' }))).toBe(true);
    });

    it('reports not configured when apiToken is absent', () => {
        expect(hasEffectiveGatewayTokenSync(user())).toBe(false);
        expect(hasEffectiveGatewayTokenSync(user({ apiToken: null }))).toBe(false);
        expect(hasEffectiveGatewayTokenSync(user({ apiToken: '  ' }))).toBe(false);
    });

    it('matches correct token with timing-safe comparison', () => {
        const cfg = user({ apiToken: 'my-secret-token' });
        expect(matchesGatewayTokenSync(cfg, 'my-secret-token')).toBe(true);
        expect(matchesGatewayTokenSync(cfg, 'wrong-token')).toBe(false);
        expect(matchesGatewayTokenSync(cfg, '')).toBe(false);
    });

    it('rejects all tokens when apiToken is not configured', () => {
        expect(matchesGatewayTokenSync(user(), 'any-token')).toBe(false);
    });
});
