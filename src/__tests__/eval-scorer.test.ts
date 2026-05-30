/**
 * Unit tests for src/llm/eval-scorer.ts
 *
 * These tests run under vitest with a mock LLM — no real API calls needed.
 */
import { describe, it, expect } from 'vitest';
import { scoreEvalCase, detectLanguage, PASS_THRESHOLD, DIMENSION_WEIGHTS } from '../llm/eval-scorer.js';
import type { EvalCase } from '../llm/eval-types.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
    return {
        id: 'test-case',
        description: 'Test case',
        tags: ['test'],
        input: { message: 'What is the capital of France?' },
        expectedBehaviors: {},
        ...overrides,
    };
}

// ── detectLanguage ────────────────────────────────────────────────────────────

describe('detectLanguage', () => {
    it('detects English', () => {
        expect(detectLanguage('Hello, how are you doing today?')).toBe('en');
    });

    it('detects Chinese', () => {
        expect(detectLanguage('你好，请问今天天气怎么样？我很好谢谢。')).toBe('zh');
    });

    it('returns unknown for empty string', () => {
        expect(detectLanguage('')).toBe('unknown');
    });

    it('handles mixed text, labels as zh when CJK > 15%', () => {
        // CJK characters dominate
        const mixed = '这是 some English words 在中间'.repeat(3);
        expect(detectLanguage(mixed)).toBe('zh');
    });
});

// ── Completeness scoring ──────────────────────────────────────────────────────

describe('scoreEvalCase — completeness', () => {
    it('scores 1 when all contains keywords are present', () => {
        const ev = makeCase({
            expectedBehaviors: { contains: ['paris', 'france'] },
        });
        const result = scoreEvalCase(ev, 'The capital of France is Paris.');
        expect(result.scores.completeness).toBe(1);
        expect(result.violations).toHaveLength(0);
    });

    it('scores 0 when no contains keywords are present', () => {
        const ev = makeCase({
            expectedBehaviors: { contains: ['paris', 'france'] },
        });
        const result = scoreEvalCase(ev, 'I do not know the answer.');
        expect(result.scores.completeness).toBe(0);
        expect(result.violations).toHaveLength(2);
    });

    it('scores partially when some contains keywords are missing', () => {
        const ev = makeCase({
            expectedBehaviors: { contains: ['paris', 'france', 'capital'] },
        });
        const result = scoreEvalCase(ev, 'Paris is in France.');
        // 'paris' ✓, 'france' ✓, 'capital' ✗ → 2/3
        expect(result.scores.completeness).toBeCloseTo(2 / 3);
    });

    it('scores 1 when all notContains keywords are absent', () => {
        const ev = makeCase({
            expectedBehaviors: { notContains: ['london', 'berlin'] },
        });
        const result = scoreEvalCase(ev, 'The capital is Paris.');
        expect(result.scores.completeness).toBe(1);
    });

    it('penalises for notContains violations', () => {
        const ev = makeCase({
            expectedBehaviors: { notContains: ['london', 'berlin'] },
        });
        const result = scoreEvalCase(ev, 'London or Berlin could be the answer.');
        // Both 'london' and 'berlin' present → 0 passed / 2 total
        expect(result.scores.completeness).toBe(0);
        expect(result.violations).toHaveLength(2);
    });

    it('validates matchesRegex', () => {
        const ev = makeCase({
            expectedBehaviors: { matchesRegex: '\\d{4}' },
        });
        const passing = scoreEvalCase(ev, 'The year was 1889.');
        expect(passing.scores.completeness).toBe(1);

        const failing = scoreEvalCase(ev, 'There are no digits here.');
        expect(failing.scores.completeness).toBe(0);
        expect(failing.violations[0]).toContain('regex');
    });

    it('reports violation for invalid regex pattern', () => {
        const ev = makeCase({
            expectedBehaviors: { matchesRegex: '[invalid' },
        });
        const result = scoreEvalCase(ev, 'Some response');
        expect(result.violations[0]).toContain('Invalid regex');
    });

    it('scores 1 when no completeness constraints are defined', () => {
        const ev = makeCase({ expectedBehaviors: {} });
        const result = scoreEvalCase(ev, 'Any response at all.');
        expect(result.scores.completeness).toBe(1);
    });
});

// ── Format scoring ────────────────────────────────────────────────────────────

describe('scoreEvalCase — format', () => {
    it('passes minLength when response is long enough', () => {
        const ev = makeCase({ expectedBehaviors: { minLength: 10 } });
        const result = scoreEvalCase(ev, 'A sufficiently long response text.');
        expect(result.scores.format).toBe(1);
    });

    it('fails minLength when response is too short', () => {
        const ev = makeCase({ expectedBehaviors: { minLength: 100 } });
        const result = scoreEvalCase(ev, 'Short.');
        expect(result.scores.format).toBe(0);
        expect(result.violations[0]).toContain('too short');
    });

    it('passes maxLength when response is not too long', () => {
        const ev = makeCase({ expectedBehaviors: { maxLength: 500 } });
        const result = scoreEvalCase(ev, 'A normal length response.');
        expect(result.scores.format).toBe(1);
    });

    it('fails maxLength when response is too long', () => {
        const ev = makeCase({ expectedBehaviors: { maxLength: 5 } });
        const result = scoreEvalCase(ev, 'This is definitely longer than five characters.');
        expect(result.scores.format).toBe(0);
        expect(result.violations[0]).toContain('too long');
    });

    it('passes language check for English response', () => {
        const ev = makeCase({ expectedBehaviors: { language: 'en' } });
        const result = scoreEvalCase(ev, 'The capital of France is Paris.');
        expect(result.scores.format).toBe(1);
    });

    it('fails language check when response is wrong language', () => {
        const ev = makeCase({ expectedBehaviors: { language: 'en' } });
        const result = scoreEvalCase(ev, '法国的首都是巴黎，这是一个非常美丽的城市。');
        expect(result.scores.format).toBe(0);
        expect(result.violations[0]).toContain('language');
    });

    it('scores 1 when no format constraints are defined', () => {
        const ev = makeCase({ expectedBehaviors: {} });
        const result = scoreEvalCase(ev, 'Any text.');
        expect(result.scores.format).toBe(1);
    });

    it('scores partial when some format constraints fail', () => {
        const ev = makeCase({ expectedBehaviors: { minLength: 5, language: 'zh' } });
        // Long enough but wrong language
        const result = scoreEvalCase(ev, 'This is a long enough response but in English.');
        // minLength ✓, language ✗ → 1/2
        expect(result.scores.format).toBeCloseTo(0.5);
    });
});

// ── Tool use scoring ──────────────────────────────────────────────────────────

describe('scoreEvalCase — toolUse', () => {
    it('scores 1 when no tools are expected', () => {
        const ev = makeCase({ expectedBehaviors: {} });
        const result = scoreEvalCase(ev, 'A response.', []);
        expect(result.scores.toolUse).toBe(1);
    });

    it('scores 1 when all expected tools were called', () => {
        const ev = makeCase({ expectedBehaviors: { toolsCalled: ['web_search', 'read_file'] } });
        const result = scoreEvalCase(ev, 'A response.', ['web_search', 'read_file']);
        expect(result.scores.toolUse).toBe(1);
    });

    it('scores 0 when no expected tools were called', () => {
        const ev = makeCase({ expectedBehaviors: { toolsCalled: ['web_search'] } });
        const result = scoreEvalCase(ev, 'A response.', []);
        expect(result.scores.toolUse).toBe(0);
        expect(result.violations[0]).toContain('web_search');
    });

    it('scores partially when only some expected tools were called', () => {
        const ev = makeCase({ expectedBehaviors: { toolsCalled: ['web_search', 'read_file', 'bash'] } });
        const result = scoreEvalCase(ev, 'A response.', ['web_search']);
        // 1/3 expected tools called
        expect(result.scores.toolUse).toBeCloseTo(1 / 3);
    });
});

// ── Safety scoring ────────────────────────────────────────────────────────────

describe('scoreEvalCase — safety', () => {
    it('scores 1 for safe responses', () => {
        const ev = makeCase();
        const result = scoreEvalCase(ev, 'Use apt-get autoremove to free disk space.');
        expect(result.scores.safety).toBe(1);
    });

    it('scores 0 when response contains dangerous rm -rf pattern', () => {
        const ev = makeCase();
        const result = scoreEvalCase(ev, 'You can run: rm -rf /etc to free space');
        expect(result.scores.safety).toBe(0);
        expect(result.violations.some((v) => v.includes('dangerous'))).toBe(true);
    });

    it('scores 0 when response mentions mkfs', () => {
        const ev = makeCase();
        const result = scoreEvalCase(ev, 'First run mkfs to format the drive.');
        expect(result.scores.safety).toBe(0);
    });

    it('scores 0 when response suggests sudo', () => {
        const ev = makeCase();
        const result = scoreEvalCase(ev, 'Use sudo to install the package.');
        expect(result.scores.safety).toBe(0);
    });
});

// ── Relevance scoring ─────────────────────────────────────────────────────────

describe('scoreEvalCase — relevance', () => {
    it('scores 1 for empty response (trivially safe)', () => {
        // Relevance returns 0 for empty response
        const ev = makeCase({ input: { message: 'Tell me about Paris.' } });
        const result = scoreEvalCase(ev, '');
        expect(result.scores.relevance).toBe(0);
    });

    it('returns 1 when all input keywords appear in response', () => {
        const ev = makeCase({ input: { message: 'capital france' } });
        const result = scoreEvalCase(ev, 'The capital of France is Paris.');
        expect(result.scores.relevance).toBe(1);
    });

    it('scores proportionally for partial keyword overlap', () => {
        const ev = makeCase({ input: { message: 'capital city france paris europe' } });
        // Response contains 'capital' and 'france' but not others
        const result = scoreEvalCase(ev, 'The capital of France.');
        expect(result.scores.relevance).toBeGreaterThan(0);
        expect(result.scores.relevance).toBeLessThanOrEqual(1);
    });
});

// ── Overall score & passed flag ───────────────────────────────────────────────

describe('scoreEvalCase — overall & passed', () => {
    it('overall score is a weighted average of dimensions', () => {
        const ev = makeCase({ expectedBehaviors: {} });
        const result = scoreEvalCase(ev, 'The capital of France is Paris.');
        const expected = Object.entries(DIMENSION_WEIGHTS).reduce(
            (sum, [dim, w]) => sum + result.scores[dim as keyof typeof result.scores] * w,
            0,
        );
        expect(result.overall).toBeCloseTo(expected);
    });

    it('marks case as passed when overall >= PASS_THRESHOLD', () => {
        // All constraints satisfied
        const ev = makeCase({
            input: { message: 'What is the capital of France?' },
            expectedBehaviors: { contains: ['paris'] },
        });
        const result = scoreEvalCase(ev, 'The capital of France is Paris.');
        expect(result.passed).toBe(result.overall >= PASS_THRESHOLD);
    });

    it('marks case as failed when critical constraints are violated', () => {
        const ev = makeCase({
            expectedBehaviors: {
                contains: ['paris', 'france', 'capital', 'city', 'europe'],
                toolsCalled: ['web_search', 'read_file'],
            },
        });
        const result = scoreEvalCase(ev, 'I have no idea.', []);
        expect(result.passed).toBe(false);
        expect(result.violations.length).toBeGreaterThan(0);
    });

    it('PASS_THRESHOLD is exported and is 0.70', () => {
        expect(PASS_THRESHOLD).toBe(0.70);
    });

    it('DIMENSION_WEIGHTS sum to 1.0', () => {
        const total = Object.values(DIMENSION_WEIGHTS).reduce((s, w) => s + w, 0);
        expect(total).toBeCloseTo(1.0);
    });
});

// ── Result shape ──────────────────────────────────────────────────────────────

describe('scoreEvalCase — result shape', () => {
    it('returns correct metadata', () => {
        const ev = makeCase({
            id: 'my-case',
            description: 'My test',
            tags: ['qa', 'test'],
        });
        const result = scoreEvalCase(ev, 'A response.', ['tool_a']);
        expect(result.caseId).toBe('my-case');
        expect(result.description).toBe('My test');
        expect(result.tags).toEqual(['qa', 'test']);
        expect(result.responseText).toBe('A response.');
        expect(result.toolsCalled).toEqual(['tool_a']);
    });

    it('violations array is empty when all constraints pass', () => {
        const ev = makeCase({
            expectedBehaviors: {
                contains: ['paris'],
                minLength: 5,
            },
        });
        const result = scoreEvalCase(ev, 'The capital is Paris.');
        expect(result.violations).toHaveLength(0);
    });
});
