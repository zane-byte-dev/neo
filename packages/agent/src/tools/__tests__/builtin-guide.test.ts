import { describe, it, expect } from 'vitest';
import { buildBuiltinToolsGuide } from '../builtin-guide.js';
import type { Tool } from '../../llm/types.js';

function fakeTool(name: string): Tool {
    return {
        declaration: { name, description: name, parameters: { type: 'object', properties: {} } },
        handler: async () => 'ok',
    };
}

describe('buildBuiltinToolsGuide', () => {
    it('includes built-in declarations (bash/read_file/write_file/list_dir)', () => {
        const out = buildBuiltinToolsGuide(new Map());
        expect(out).toContain('`bash`');
        expect(out).toContain('`read_file`');
        expect(out).toContain('`write_file`');
        expect(out).toContain('`list_dir`');
    });

    it('emits curated descriptions in stable order before unknown tools', () => {
        const reg = new Map<string, Tool>([
            ['edit_file', fakeTool('edit_file')],
            ['glob', fakeTool('glob')],
            ['custom_unknown', fakeTool('custom_unknown')],
        ]);
        const out = buildBuiltinToolsGuide(reg);
        expect(out).toContain('`edit_file`');
        expect(out).toContain('`glob`');
        // unknown tool falls back to its own name as description
        expect(out).toContain('| custom_unknown | `custom_unknown` |');
        // ordering: edit_file appears before custom_unknown
        expect(out.indexOf('`edit_file`')).toBeLessThan(out.indexOf('`custom_unknown`'));
    });

    it('produces the file-operations and search principles trailers', () => {
        const out = buildBuiltinToolsGuide(new Map());
        expect(out).toContain('## 文件操作原则');
        expect(out).toContain('## 搜索原则');
        expect(out).toContain('## 任务管理原则');
    });

    it('does not duplicate a tool that is in both built-ins and the registry', () => {
        // read_file is a built-in; if registry also has it, only one row should appear.
        const reg = new Map<string, Tool>([['read_file', fakeTool('read_file')]]);
        const out = buildBuiltinToolsGuide(reg);
        const tableRows = out.match(/^\| .* \| `read_file` \|$/gm) ?? [];
        expect(tableRows.length).toBe(1);
    });
});
