import { describe, expect, it } from 'vitest';
import { resolveSmartModel, resolveSmartRoute } from '../model-router.js';

describe('resolveSmartRoute', () => {
    it('passes through explicit user model', () => {
        const route = resolveSmartRoute({
            userModel: 'deepseek',
            hasTools: true,
            message: 'anything',
        });
        expect(route.model).toBe('deepseek');
        expect(route.reason).toBe('user_selected');
    });

    it('returns structured route in auto mode', () => {
        const route = resolveSmartRoute({
            hasTools: true,
            message: '你好',
            toolCount: 3,
            conversationDepth: 1,
        });
        expect(route.model).toBeTypeOf('string');
        expect(route.tier).toBe('standard');
        expect(route.fallbackChain.length).toBeGreaterThan(0);
    });
});

describe('resolveSmartModel', () => {
    it('returns model alias only', () => {
        const model = resolveSmartModel({
            hasTools: false,
            message: 'hello',
        });
        expect(model).toBeTypeOf('string');
    });
});

