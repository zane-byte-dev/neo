import { describe, it, expect } from 'vitest';
import { searchToolsTool } from '../search-tools.js';
import type { ToolContext } from '../../../llm/types.js';

function ctx(mode?: ToolContext['mode']): ToolContext {
    return {
        userId: 'u',
        sessionId: 's',
        workDir: '/tmp',
        stateDir: '/tmp',
        systemInstruction: '',
        ...(mode && { mode }),
    } as ToolContext;
}

describe('search_tools tool', () => {
    it('declares a read-tier utility tool', () => {
        expect(searchToolsTool.declaration.name).toBe('search_tools');
        expect(searchToolsTool.meta?.permission).toBe('read');
    });

    it('errors when no parameter is provided', async () => {
        const out = await searchToolsTool.handler({}, '/tmp', ctx());
        expect(out).toContain('[Error]');
    });

    it('returns full detail for an exact tool name', async () => {
        const out = await searchToolsTool.handler({ name: 'read_file' }, '/tmp', ctx());
        expect(out).toContain('### `read_file`');
        expect(out).toContain('```json');
    });

    it('returns a friendly miss message for unknown tools', async () => {
        const out = await searchToolsTool.handler({ name: 'does_not_exist' }, '/tmp', ctx());
        expect(out).toContain('未找到匹配的工具');
    });

    it('does not reveal write/dangerous tools in plan mode', async () => {
        const out = await searchToolsTool.handler({ name: 'bash' }, '/tmp', ctx('plan'));
        expect(out).toContain('未找到匹配的工具');
    });

    it('supports keyword query matching', async () => {
        const out = await searchToolsTool.handler({ query: '目录' }, '/tmp', ctx());
        expect(out).toContain('list_dir');
    });
});
