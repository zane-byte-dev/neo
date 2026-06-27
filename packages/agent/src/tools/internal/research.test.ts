/**
 * research.test.ts — Unit tests for the research tool.
 *
 * Tests cover:
 *   - Pure prompt-builder functions (buildResearchSystemPrompt, buildResearchPrompt)
 *   - Tool declaration shape and metadata
 *   - Handler input validation (missing topic, defaults)
 */

import { describe, it, expect, vi } from 'vitest';
import { researchTool, buildResearchSystemPrompt, buildResearchPrompt } from './research.js';

// ── Tool declaration tests ───────────────────────────────────────────────────

describe('researchTool declaration', () => {
    it('has correct name and category', () => {
        expect(researchTool.declaration.name).toBe('research');
        expect(researchTool.meta?.category).toBe('web');
    });

    it('requires topic parameter', () => {
        expect(researchTool.declaration.parameters.required).toContain('topic');
    });

    it('declares topic, depth, and language parameters', () => {
        const props = researchTool.declaration.parameters.properties;
        expect(props).toHaveProperty('topic');
        expect(props).toHaveProperty('depth');
        expect(props).toHaveProperty('language');
    });

    it('has a non-empty description', () => {
        expect(researchTool.declaration.description.length).toBeGreaterThan(10);
    });
});

// ── buildResearchSystemPrompt tests ──────────────────────────────────────────

describe('buildResearchSystemPrompt', () => {
    it('includes search_web and fetch_url tool names', () => {
        const prompt = buildResearchSystemPrompt('中文', false);
        expect(prompt).toContain('search_web');
        expect(prompt).toContain('fetch_url');
    });

    it('includes the specified language in the output format section', () => {
        const prompt = buildResearchSystemPrompt('English', false);
        expect(prompt).toContain('English');
    });

    it('includes quick instructions when isDeep is false', () => {
        const prompt = buildResearchSystemPrompt('中文', false);
        expect(prompt).toContain('快速调研');
        expect(prompt).toContain('1-2 次');
    });

    it('includes deep instructions when isDeep is true', () => {
        const prompt = buildResearchSystemPrompt('中文', true);
        expect(prompt).toContain('深入调研');
        expect(prompt).toContain('3-4 次');
        expect(prompt).toContain('交叉验证');
    });

    it('includes report structure guidance', () => {
        const prompt = buildResearchSystemPrompt('中文', false);
        expect(prompt).toContain('研究报告');
        expect(prompt).toContain('摘要');
        expect(prompt).toContain('引用来源');
    });
});

// ── buildResearchPrompt tests ────────────────────────────────────────────────

describe('buildResearchPrompt', () => {
    it('includes the topic', () => {
        const prompt = buildResearchPrompt('WebAssembly GC', '中文', false);
        expect(prompt).toContain('WebAssembly GC');
    });

    it('uses quick label for non-deep mode', () => {
        const prompt = buildResearchPrompt('test topic', '中文', false);
        expect(prompt).toContain('快速');
    });

    it('uses deep label for deep mode', () => {
        const prompt = buildResearchPrompt('test topic', '中文', true);
        expect(prompt).toContain('深入');
    });

    it('includes the specified language', () => {
        const prompt = buildResearchPrompt('AI agents', 'English', false);
        expect(prompt).toContain('English');
    });
});

// ── Handler input validation tests ───────────────────────────────────────────

describe('researchTool.handler input validation', () => {
    it('returns error when topic is empty', async () => {
        const result = await researchTool.handler({}, '/tmp/test');
        expect(result).toContain('缺少必填参数');
        expect(result).toContain('topic');
    });

    it('returns error when topic is whitespace only', async () => {
        const result = await researchTool.handler({ topic: '   ' }, '/tmp/test');
        expect(result).toContain('缺少必填参数');
    });
});
