/**
 * notebook-search.ts — Notebook-mode agent tool for source-grounded retrieval.
 *
 * Activated automatically when the chat session is bound to a notebook
 * (session.mode === 'notebook'). Searches the indexed passages of the
 * currently-selected sources and returns numbered passages 【N】 that the
 * LLM should cite verbatim in its answer. The numeric labels are stable
 * across multiple search calls within one run.
 *
 * Citations referenced in the final assistant message are surfaced back to
 * the client via SSE in the chat route — see notebook-citation-registry.ts.
 */
import type { Tool, ToolContext } from '../_base.js';
import { searchKnowledge } from '../../indexing/search.js';
import { indexNotebookSources } from '../../indexing/ingest.js';
import { registerCitation } from '../../services/notebook-citation-registry.js';

const PASSAGE_LIMIT = 8;
const SNIPPET_MAX = 1_200;

interface SearchArgs {
    query?: unknown;
    limit?: unknown;
    /** Override the bound notebook (rarely needed). */
    notebook?: unknown;
    /** Override the bound source selection (rarely needed). */
    source_ids?: unknown;
}

function asString(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return out.length ? out : undefined;
}

export const notebookSearchTool: Tool = {
    meta: { category: 'knowledge', version: '1.0.0', permission: 'read' },
    declaration: {
        name: 'notebook_search',
        description:
            '在当前 notebook 的来源中检索与问题相关的段落。会自动使用会话已选定的 notebook 与 source 列表，' +
            '通常无需提供任何参数。返回 N 条带【N】编号的段落片段；在最终回答中请按【N】格式引用。',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '检索关键词（默认使用用户最新提问）' },
                limit: { type: 'number', description: '最多返回多少段落，默认 8（最多 20）' },
                notebook: { type: 'string', description: '高级用法：覆盖会话绑定的 notebook' },
                source_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '高级用法：覆盖会话当前选中的 source 列表',
                },
            },
            required: ['query'],
        },
    },

    handler: async (args, workDir, context?: ToolContext) => {
        const a = args as SearchArgs;
        const query = asString(a.query);
        if (!query) return '【notebook_search】缺少 query。';

        const notebook = asString(a.notebook) ?? context?.notebookId;
        if (!notebook) {
            return '【notebook_search】当前会话未绑定 notebook，此工具仅在 notebook 模式下可用。';
        }

        const sourceIds = asStringArray(a.source_ids) ?? context?.sourceIds;
        const limit = Math.min(Math.max(Number(a.limit) || PASSAGE_LIMIT, 1), 20);

        // Ensure index is up to date for the requested sources (cheap when unchanged).
        try {
            indexNotebookSources(workDir, notebook, sourceIds);
        } catch {
            /* index errors are non-fatal — we still attempt search */
        }

        const hits = searchKnowledge({
            workDir,
            query,
            kinds: ['notebook_source'],
            notebook,
            ...(sourceIds && sourceIds.length > 0 ? { sourceIds } : {}),
            limit,
        }).filter(h => Boolean(h.sourceId));

        if (hits.length === 0) {
            return `【notebook_search】未在所选来源中找到与 "${query}" 相关的段落。`;
        }

        const lines: string[] = [];
        lines.push(`# 检索到 ${hits.length} 条与 "${query}" 相关的段落`);
        lines.push('');
        lines.push('请在回答中按【N】格式引用对应来源；不要编造来源外的信息。');
        lines.push('');

        for (const hit of hits) {
            const sourceId = hit.sourceId!;
            const n = context?.runId
                ? registerCitation(context.runId, {
                    sourceId,
                    title: hit.title,
                    snippet: hit.text.slice(0, 280),
                    ...(hit.chunkId !== undefined && { chunkId: hit.chunkId }),
                    ...(hit.charStart !== undefined && { charStart: hit.charStart }),
                    ...(hit.charEnd !== undefined && { charEnd: hit.charEnd }),
                })
                : 0;
            const label = n > 0 ? `【${n}】` : '【?】';
            const text = hit.text.length > SNIPPET_MAX ? hit.text.slice(0, SNIPPET_MAX) + ' …' : hit.text;
            lines.push(`━━ ${label} ${hit.title} (id=${sourceId}) ━━`);
            lines.push(text);
            lines.push('');
        }

        return lines.join('\n').trim();
    },
};
