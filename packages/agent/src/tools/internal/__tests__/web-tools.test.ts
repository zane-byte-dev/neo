/**
 * Tests for web/utility tools: fetch_url, get_weather, ask_user, run_skill, list_skills.
 * Network calls are mocked via vi.spyOn(globalThis, 'fetch').
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { fetchUrlTool } from '../fetch-url.js';
import { getWeatherTool } from '../get-weather.js';
import { askUserTool } from '../ask-user.js';
import { runSkillTool, listSkillsTool } from '../run-skill.js';

afterEach(() => {
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────── fetch_url ──

describe('fetch_url tool', () => {
    it('rejects URLs not starting with http(s)://', async () => {
        const out = await fetchUrlTool.handler({ url: 'ftp://example.com' }, '/tmp');
        expect(out).toContain('[Error]');
    });

    it('returns extracted plain text on a successful HTML response', async () => {
        const html = '<html><head><style>x{}</style></head><body><script>bad()</script><p>Hello&nbsp;<b>world</b></p></body></html>';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html, { status: 200 }));
        const out = await fetchUrlTool.handler({ url: 'https://example.com' }, '/tmp');
        expect(out).toContain('Hello');
        expect(out).toContain('world');
        expect(out).not.toContain('<script>');
        expect(out).not.toContain('<style>');
    });

    it('truncates long content to max_chars', async () => {
        const big = '<html><body>' + 'a'.repeat(20000) + '</body></html>';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(big, { status: 200 }));
        const out = await fetchUrlTool.handler({ url: 'https://x.com', max_chars: 200 }, '/tmp');
        expect(out.length).toBeLessThan(400); // 200 + truncate marker
        expect(out).toContain('已截断');
    });

    it('reports HTTP error for non-blocked failure (e.g. 500 stays after retries)', async () => {
        // 500 triggers retries inside withRetry; the 4xx-non-blocked branch we exercise is 404.
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 404 }));
        const out = await fetchUrlTool.handler({ url: 'https://x.com/missing' }, '/tmp');
        expect(out).toContain('[Error]');
        expect(out).toContain('404');
    });
});

// ────────────────────────────────────────────────────────────── get_weather ──

describe('get_weather tool', () => {
    it('returns formatted weather for a known city', async () => {
        const geo = { results: [{
            latitude: 30.27, longitude: 120.16, name: 'Hangzhou',
            admin1: 'Zhejiang', country: 'China', population: 9000000, feature_code: 'PPLA',
        }] };
        const weather = {
            current: {
                temperature_2m: 22, apparent_temperature: 21, weather_code: 1,
                relative_humidity_2m: 60, wind_speed_10m: 5,
            },
            daily: {
                time: ['2026-04-27', '2026-04-28', '2026-04-29'],
                weather_code: [1, 2, 3],
                temperature_2m_max: [25, 24, 23],
                temperature_2m_min: [15, 14, 13],
            },
        };
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify(geo), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(weather), { status: 200 }));
        const out = await getWeatherTool.handler({ location: 'Hangzhou' }, '/tmp');
        expect(out).toContain('Hangzhou');
        expect(out).toContain('22°C');
        expect(out).toContain('未来3天预报');
    });

    it('reports city-not-found when geocoding returns empty', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(JSON.stringify({ results: [] }), { status: 200 }),
        );
        const out = await getWeatherTool.handler({ location: 'Atlantis' }, '/tmp');
        expect(out).toContain('[Error]');
        expect(out).toContain('找不到');
    });

    it('catches fetch errors gracefully', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));
        const out = await getWeatherTool.handler({ location: 'NoNet' }, '/tmp');
        expect(out).toContain('[Error]');
        expect(out).toContain('天气获取失败');
    });
});

// ───────────────────────────────────────────────────────────────── ask_user ──

describe('ask_user tool', () => {
    it('formats a simple question', async () => {
        const out = await askUserTool.handler({ question: '继续吗？' }, '/tmp');
        expect(out).toContain('继续吗？');
        expect(out).toContain('等待用户回复');
    });

    it('includes context and options', async () => {
        const out = await askUserTool.handler({
            question: '选哪个？',
            context: '上一步失败了',
            options: JSON.stringify(['重试', '跳过', '取消']),
        }, '/tmp');
        expect(out).toContain('上一步失败了');
        expect(out).toContain('重试');
        expect(out).toContain('跳过');
        expect(out).toContain('取消');
    });

    it('ignores malformed options JSON', async () => {
        const out = await askUserTool.handler({
            question: '?', options: 'not json',
        }, '/tmp');
        expect(out).toContain('?');
    });

    it('errors when question is empty', async () => {
        const out = await askUserTool.handler({ question: '' }, '/tmp');
        expect(out).toContain('[Error]');
    });
});

// ─────────────────────────────────────────────── run_skill / list_skills ──

const baseCtx = {
    userId: 'u1',
    sessionId: 's1',
    workDir: '/tmp',
    systemInstruction: '',
};

describe('run_skill / list_skills (early-return paths)', () => {
    it('run_skill rejects empty skill_name', async () => {
        const out = await runSkillTool.handler({ skill_name: '' }, '/tmp', baseCtx as any);
        expect(out).toContain('Missing skill_name');
    });

    it('run_skill complains when no registry in context', async () => {
        const out = await runSkillTool.handler({ skill_name: 'foo' }, '/tmp', baseCtx as any);
        expect(out).toContain('Skill registry not available');
    });

    it('run_skill reports unknown skill with available list', async () => {
        const registry = {
            get: () => undefined,
            list: () => [{ frontmatter: { name: 'summarize_text' } }],
        } as any;
        const out = await runSkillTool.handler(
            { skill_name: 'no_such' },
            '/tmp', { ...baseCtx, skillRegistry: registry } as any,
        );
        expect(out).toContain('Unknown skill');
        expect(out).toContain('summarize_text');
    });

    it('run_skill rejects malformed args JSON', async () => {
        const registry = {
            get: () => ({ frontmatter: { name: 'foo' } }),
            list: () => [],
        } as any;
        const out = await runSkillTool.handler(
            { skill_name: 'foo', args: '{not json' },
            '/tmp', { ...baseCtx, skillRegistry: registry } as any,
        );
        expect(out).toContain('Invalid args JSON');
    });

    it('list_skills complains when no registry', async () => {
        const out = await listSkillsTool.handler({}, '/tmp', baseCtx as any);
        expect(out).toContain('Skill registry not available');
    });

    it('list_skills returns placeholder when no skills', async () => {
        const registry = { list: () => [] } as any;
        const out = await listSkillsTool.handler(
            {}, '/tmp', { ...baseCtx, skillRegistry: registry } as any,
        );
        expect(out).toContain('没有已注册的技能');
    });

    it('list_skills formats skills with parameters', async () => {
        const registry = {
            list: () => [{
                frontmatter: {
                    name: 'summarize_text',
                    description: 'Summarize a long text',
                    parameters: {
                        properties: { text: { type: 'string', description: 'Input text' } },
                        required: ['text'],
                    },
                },
            }],
        } as any;
        const out = await listSkillsTool.handler(
            {}, '/tmp', { ...baseCtx, skillRegistry: registry } as any,
        );
        expect(out).toContain('summarize_text');
        expect(out).toContain('Summarize a long text');
        expect(out).toContain('text (string)');
        expect(out).toContain('必填：text');
    });
});
