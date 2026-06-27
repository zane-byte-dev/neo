import { describe, it, expect } from 'vitest';
import {
    classifyToolError,
    isFailureResult,
    formatErrorHint,
    type ClassifiedError,
} from '../tool-error-classifier.js';
import type { Tool } from '../types.js';

describe('isFailureResult', () => {
    it('treats [Error] prefix as failure', () => {
        expect(isFailureResult('[Error] boom')).toBe(true);
        expect(isFailureResult('  [Error] boom')).toBe(true);
    });
    it('does not treat normal output as failure', () => {
        expect(isFailureResult('here is the result, no errors')).toBe(false);
        expect(isFailureResult('[Info] 暂无搜索结果')).toBe(false);
        expect(isFailureResult(123 as unknown)).toBe(false);
    });
});

describe('classifyToolError — heuristics', () => {
    it('returns null for a successful (non-failure) result', () => {
        expect(classifyToolError('t', 'all good, no error here')).toBeNull();
    });

    it('classifies HTTP 401/403/404 as permanent (not retryable)', () => {
        for (const code of [401, 403, 404]) {
            const c = classifyToolError('fetch_url', `[Error] HTTP ${code} — denied`);
            expect(c?.type).toBe('permanent');
            expect(c?.retryable).toBe(false);
        }
    });

    it('classifies HTTP 429 as quota (retryable)', () => {
        const c = classifyToolError('fetch_url', '[Error] HTTP 429 — rate limited');
        expect(c?.type).toBe('quota');
        expect(c?.retryable).toBe(true);
    });

    it('classifies HTTP 400/422 as validation (not retryable)', () => {
        for (const code of [400, 422]) {
            const c = classifyToolError('t', `[Error] HTTP ${code} bad request`);
            expect(c?.type).toBe('validation');
            expect(c?.retryable).toBe(false);
        }
    });

    it('classifies HTTP 5xx and 408 as transient (retryable)', () => {
        for (const code of [500, 502, 503, 408]) {
            const c = classifyToolError('t', `[Error] HTTP ${code} server error`);
            expect(c?.type).toBe('transient');
            expect(c?.retryable).toBe(true);
        }
    });

    it('classifies permission keywords as permanent (CJK + EN)', () => {
        expect(classifyToolError('t', '[Error] unauthorized: invalid api key')?.type).toBe('permanent');
        expect(classifyToolError('t', '[Error] 权限不足，拒绝访问')?.type).toBe('permanent');
        expect(classifyToolError('t', '[Error] forbidden')?.type).toBe('permanent');
    });

    it('classifies invalid-argument keywords as validation', () => {
        expect(classifyToolError('t', '[Error] invalid argument: foo')?.type).toBe('validation');
        expect(classifyToolError('t', '[Error] 参数非法')?.type).toBe('validation');
        expect(classifyToolError('t', '[Error] missing required field')?.type).toBe('validation');
    });

    it('classifies network/timeout keywords as transient', () => {
        expect(classifyToolError('t', '[Error] request timeout')?.type).toBe('transient');
        expect(classifyToolError('t', '[Error] 网络错误')?.type).toBe('transient');
        expect(classifyToolError('t', '[Error] ECONNRESET')?.type).toBe('transient');
        expect(classifyToolError('t', '[Error] 超时')?.type).toBe('transient');
    });

    it('classifies rate-limit / quota keywords as quota', () => {
        expect(classifyToolError('t', '[Error] rate limit exceeded')?.type).toBe('quota');
        expect(classifyToolError('t', '[Error] 配额已用尽')?.type).toBe('quota');
    });

    it('falls back to unknown for unrecognized failures', () => {
        const c = classifyToolError('new_tool', '[Error] something weird happened');
        expect(c?.type).toBe('unknown');
        expect(c?.retryable).toBe(false);
    });

    it('classifies a thrown error even without [Error] prefix', () => {
        const c = classifyToolError('t', 'partial output', new Error('connection reset'));
        expect(c?.type).toBe('transient');
    });
});

describe('classifyToolError — per-tool override precedence', () => {
    function toolWithOverride(result: ClassifiedError | null): Tool {
        return {
            declaration: { name: 'ov', description: 'd', parameters: { type: 'object', properties: {} } },
            handler: async () => '',
            meta: { classifyError: () => result },
        };
    }

    it('uses the override result when provided', () => {
        const tool = toolWithOverride({ type: 'permanent', retryable: false, suggestion: 'stop' });
        // Heuristics alone would call this transient; override wins.
        const c = classifyToolError('ov', '[Error] HTTP 503', undefined, tool);
        expect(c?.type).toBe('permanent');
        expect(c?.suggestion).toBe('stop');
    });

    it('falls back to heuristics when override returns null', () => {
        const tool = toolWithOverride(null);
        const c = classifyToolError('ov', '[Error] HTTP 503', undefined, tool);
        expect(c?.type).toBe('transient');
    });

    it('falls back to heuristics when override throws', () => {
        const tool: Tool = {
            declaration: { name: 'ov', description: 'd', parameters: { type: 'object', properties: {} } },
            handler: async () => '',
            meta: {
                classifyError: () => {
                    throw new Error('boom');
                },
            },
        };
        const c = classifyToolError('ov', '[Error] HTTP 401', undefined, tool);
        expect(c?.type).toBe('permanent');
    });
});

describe('formatErrorHint', () => {
    it('produces a stable, parseable block', () => {
        const hint = formatErrorHint({ type: 'permanent', retryable: false, suggestion: 'change source' });
        expect(hint).toContain('[ToolError] type=permanent retryable=false');
        expect(hint).toContain('suggestion: change source');
    });
});
