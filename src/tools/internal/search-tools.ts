/**
 * src/tools/internal/search-tools.ts — `search_tools` (lazy tool context).
 *
 * In the compact tool-catalog experience, the system prompt only lists tool
 * names + one-line summaries. When the model needs a tool's full description,
 * parameter schema, or usage notes, it calls `search_tools` to expand detail
 * on demand — by exact name, free-text query, or category.
 *
 * Read-only tier: it surfaces documentation, never mutates state. Results
 * respect plan / notebook mode (write / dangerous tools are not revealed there),
 * matching how `buildToolCatalog()` filters by mode.
 */

import type { Tool } from '../_base.js';
import { getToolRegistry } from '../../llm/client.js';
import { lookupToolDetail, renderToolDetail } from '../tool-catalog.js';

export const searchToolsTool: Tool = {
    meta: { category: 'utility', version: '1.0.0', permission: 'read' },
    declaration: {
        name: 'search_tools',
        description:
            'Expand the full documentation (description, parameter schema, usage notes) ' +
            'for one or more available tools. The system prompt only lists a compact ' +
            'catalog (tool name + one-line purpose); call this before using a tool whose ' +
            'exact parameters you are unsure about. ' +
            'Provide `name` for an exact match, `query` for a keyword search across ' +
            'names / summaries / descriptions, or `category` to list a group.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Exact tool name, e.g. "edit_file".' },
                query: {
                    type: 'string',
                    description: 'Keyword to match against tool name / purpose / description.',
                },
                category: {
                    type: 'string',
                    description: 'Tool category, e.g. "web", "knowledge", "utility".',
                },
            },
        },
    },
    handler: async (args, _workDir, context) => {
        const name = typeof args.name === 'string' ? args.name : undefined;
        const query = typeof args.query === 'string' ? args.query : undefined;
        const category = typeof args.category === 'string' ? args.category : undefined;

        if (!name && !query && !category) {
            return '[Error] search_tools requires one of: name, query, or category.';
        }

        const registry = getToolRegistry();
        const matches = lookupToolDetail({ name, query, category }, registry, context);

        if (matches.length === 0) {
            const what = name ?? query ?? category ?? '';
            return `未找到匹配的工具：${what}。可改用 query 关键词检索，或查看精简目录中的工具名。`;
        }

        const header = `匹配到 ${matches.length} 个工具：\n`;
        return header + matches.map(renderToolDetail).join('\n\n');
    },
};
