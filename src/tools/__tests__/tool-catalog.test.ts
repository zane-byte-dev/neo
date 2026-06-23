import { describe, it, expect } from 'vitest';
import {
    buildToolCatalog,
    renderCompactCatalog,
    lookupToolDetail,
    renderToolDetail,
    summaryFor,
    TOOL_SUMMARIES,
} from '../tool-catalog.js';
import type { Tool, ToolContext } from '../../llm/types.js';

function fakeTool(name: string, opts?: Partial<Tool['meta']> & { description?: string }): Tool {
    return {
        meta: { permission: opts?.permission, category: opts?.category, version: '1.0.0' },
        declaration: {
            name,
            description: opts?.description ?? `desc of ${name}`,
            parameters: { type: 'object', properties: {} },
        },
        handler: async () => 'ok',
    };
}

function ctx(mode?: ToolContext['mode'], userTools?: Map<string, Tool>): ToolContext {
    return {
        userId: 'u',
        sessionId: 's',
        workDir: '/tmp',
        stateDir: '/tmp',
        systemInstruction: '',
        ...(mode && { mode }),
        ...(userTools && { userTools }),
    } as ToolContext;
}

describe('buildToolCatalog', () => {
    it('includes built-in tools with correct permission tiers', () => {
        const entries = buildToolCatalog(new Map());
        const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
        expect(byName.read_file.permission).toBe('read');
        expect(byName.list_dir.permission).toBe('read');
        expect(byName.write_file.permission).toBe('write');
        expect(byName.bash.permission).toBe('dangerous');
    });

    it('uses curated summaries for known tools', () => {
        const entries = buildToolCatalog(new Map());
        const readFile = entries.find((e) => e.name === 'read_file');
        expect(readFile?.summary).toBe(TOOL_SUMMARIES.read_file);
    });

    it('filters out write/dangerous tools in plan mode', () => {
        const entries = buildToolCatalog(new Map(), ctx('plan'));
        const names = entries.map((e) => e.name);
        expect(names).toContain('read_file');
        expect(names).toContain('list_dir');
        expect(names).not.toContain('bash');
        expect(names).not.toContain('write_file');
    });

    it('includes registry and user tools, deduped with built-ins winning', () => {
        const registry = new Map<string, Tool>([['grep', fakeTool('grep', { permission: 'read' })]]);
        const userTools = new Map<string, Tool>([
            ['my_tool', fakeTool('my_tool', { permission: 'read' })],
            // duplicate built-in name should not produce two entries
            ['read_file', fakeTool('read_file')],
        ]);
        const entries = buildToolCatalog(registry, ctx(undefined, userTools));
        const names = entries.map((e) => e.name);
        expect(names).toContain('grep');
        expect(names).toContain('my_tool');
        expect(names.filter((n) => n === 'read_file')).toHaveLength(1);
    });
});

describe('summaryFor', () => {
    it('prefers the curated map', () => {
        expect(summaryFor('bash')).toBe(TOOL_SUMMARIES.bash);
    });

    it('falls back to the first line of the description', () => {
        const s = summaryFor('unknown_x', {
            name: 'unknown_x',
            description: '第一句。第二句应被丢弃。',
            parameters: { type: 'object', properties: {} },
        });
        expect(s).toBe('第一句');
    });

    it('falls back to the name when no description', () => {
        expect(summaryFor('mystery')).toBe('mystery');
    });
});

describe('renderCompactCatalog', () => {
    it('renders a table and points at search_tools', () => {
        const out = renderCompactCatalog(buildToolCatalog(new Map()));
        expect(out).toContain('| 工具 | 用途 | 权限 |');
        expect(out).toContain('`read_file`');
        expect(out).toContain('search_tools');
        // no full JSON schema in compact view
        expect(out).not.toContain('```json');
    });
});

describe('lookupToolDetail', () => {
    it('matches by exact name', () => {
        const hits = lookupToolDetail({ name: 'read_file' }, new Map());
        expect(hits).toHaveLength(1);
        expect(hits[0].name).toBe('read_file');
        expect(hits[0].description.length).toBeGreaterThan(0);
    });

    it('matches by free-text query across name/summary/description', () => {
        const hits = lookupToolDetail({ query: '目录' }, new Map());
        expect(hits.some((e) => e.name === 'list_dir')).toBe(true);
    });

    it('matches by category', () => {
        const registry = new Map<string, Tool>([
            ['fetch_x', fakeTool('fetch_x', { permission: 'read', category: 'web' })],
        ]);
        const hits = lookupToolDetail({ category: 'web' }, registry);
        expect(hits.some((e) => e.name === 'fetch_x')).toBe(true);
    });

    it('respects plan mode (no write/dangerous tools)', () => {
        const hits = lookupToolDetail({ name: 'bash' }, new Map(), ctx('plan'));
        expect(hits).toHaveLength(0);
    });

    it('returns empty when no params provided', () => {
        expect(lookupToolDetail({}, new Map())).toHaveLength(0);
    });
});

describe('renderToolDetail', () => {
    it('emits description and JSON schema', () => {
        const [entry] = lookupToolDetail({ name: 'read_file' }, new Map());
        const out = renderToolDetail(entry);
        expect(out).toContain('### `read_file`');
        expect(out).toContain('参数 schema');
        expect(out).toContain('```json');
    });
});
