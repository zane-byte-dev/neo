import { afterEach, describe, expect, it } from 'vitest';
import { isModelAliasAvailable, resolveSmartModel, resolveSmartRoute } from '../model-router.js';

const ORIGINAL_CLAUDE_CODE_BASE_URL = process.env.CLAUDE_CODE_BASE_URL;
const ORIGINAL_CLAUDE_CODE_TOKEN = process.env.CLAUDE_CODE_TOKEN;

afterEach(() => {
    if (ORIGINAL_CLAUDE_CODE_BASE_URL === undefined) delete process.env.CLAUDE_CODE_BASE_URL;
    else process.env.CLAUDE_CODE_BASE_URL = ORIGINAL_CLAUDE_CODE_BASE_URL;
    if (ORIGINAL_CLAUDE_CODE_TOKEN === undefined) delete process.env.CLAUDE_CODE_TOKEN;
    else process.env.CLAUDE_CODE_TOKEN = ORIGINAL_CLAUDE_CODE_TOKEN;
});

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

describe('isModelAliasAvailable', () => {
    it('requires both Claude Code proxy URL and token', () => {
        delete process.env.CLAUDE_CODE_BASE_URL;
        delete process.env.CLAUDE_CODE_TOKEN;
        expect(isModelAliasAvailable('claude-code')).toBe(false);

        process.env.CLAUDE_CODE_BASE_URL = 'https://proxy.example.com/v1';
        expect(isModelAliasAvailable('claude-code')).toBe(false);

        process.env.CLAUDE_CODE_TOKEN = 'test-token';
        expect(isModelAliasAvailable('claude-code')).toBe(true);
        expect(isModelAliasAvailable('claude-code-haiku')).toBe(true);
    });
});
