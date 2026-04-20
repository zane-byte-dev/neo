import { describe, expect, it } from 'vitest';
import { scoreRequest } from '../scorer.js';

describe('scoreRequest', () => {
    it('routes short greeting to simple path', () => {
        const result = scoreRequest({
            message: '你好',
            conversationDepth: 1,
            toolCount: 0,
            hasTools: false,
        });
        expect(result.tier).toBe('simple');
        expect(result.reason).toBe('short_message');
    });

    it('enforces tool floor to standard', () => {
        const result = scoreRequest({
            message: 'hi',
            conversationDepth: 1,
            toolCount: 0,
            hasTools: true,
        });
        expect(result.tier).toBe('standard');
    });

    it('scores complex code request to non-simple tier', () => {
        const result = scoreRequest({
            message: '请帮我实现一个分布式任务调度系统，需要先分析 trade-offs，然后分步给出实现方案和函数接口',
            conversationDepth: 12,
            toolCount: 8,
            hasTools: true,
        });
        expect(result.score).toBeGreaterThan(-0.05);
        expect(['standard', 'complex']).toContain(result.tier);
    });
});

