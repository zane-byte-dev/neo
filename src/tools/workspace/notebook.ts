/**
 * notebook.ts — AI tool for reading and writing the notebook knowledge base.
 *
 * Backed by SQLite (notebook_entries table) with FTS5 full-text search.
 * All DB operations are delegated to notebook-service.ts.
 *
 * Actions:
 *   list   — list all entries (title, id, date, source, tags, summary)
 *   search — full-text search via FTS5
 *   read   — get full content by id or title substring
 *   add    — create a new notebook entry
 *   update — update an existing entry by id
 *   delete — delete an entry by id
 */
import type { Tool } from '../_base.js';
import type { NotebookEntryPartial, NotebookEntry } from '../../services/notebook-service.js';
import { nbList, nbSearch, nbGet, nbGetByTitle, nbCreate, nbUpdate, nbDelete } from '../../services/notebook-service.js';

function formatTags(raw: string | null): string[] {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return [raw]; }
}

function formatMeta(row: NotebookEntryPartial): string {
    const parts: string[] = [];
    if (row.date)    parts.push(`📅 ${row.date}`);
    if (row.author)  parts.push(`✍️ ${row.author}`);
    if (row.source)  parts.push(`📌 ${row.source}`);
    const tags = formatTags(row.tags);
    if (tags.length) parts.push(`🏷️ ${tags.join(', ')}`);
    return parts.join('  ');
}

export const notebookTool: Tool = {
    meta: { category: 'knowledge', version: '1.0.0' },
    declaration: {
        name: 'notebook',
        description:
            '操作笔记本知识库（基于 SQLite + FTS5 全文搜索）。\n' +
            '• action=list   — 列出所有条目（标题、日期、标签、摘要），用于浏览\n' +
            '• action=search — 全文搜索，支持关键词、AND/OR 逻辑（如 "财富 AND 职场"）\n' +
            '• action=read   — 按 id 或标题关键词读取完整内容\n' +
            '• action=add    — 新增笔记条目\n' +
            '• action=update — 更新已有条目（按 id）\n' +
            '• action=delete — 删除条目（按 id）',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'search', 'read', 'add', 'update', 'delete'],
                    description: '操作类型',
                },
                query: {
                    type: 'string',
                    description: '[search] 搜索关键词，支持 FTS5 语法，如 "财富 AND 职场"',
                },
                id: {
                    type: 'number',
                    description: '[read/update/delete] 条目 ID',
                },
                title_query: {
                    type: 'string',
                    description: '[read] 按标题关键词查找（模糊匹配，id 优先）',
                },
                title: {
                    type: 'string',
                    description: '[add/update] 标题',
                },
                author: {
                    type: 'string',
                    description: '[add/update] 作者',
                },
                date: {
                    type: 'string',
                    description: '[add/update] 日期，ISO 格式如 "2024-03-09"',
                },
                source: {
                    type: 'string',
                    description: '[add/update] 来源，如 "西风知识库"、"书摘"、"播客"',
                },
                summary: {
                    type: 'string',
                    description: '[add/update] 摘要/核心观点',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '[add/update] 标签列表，如 ["财富", "职场"]',
                },
                content: {
                    type: 'string',
                    description: '[add/update] 正文内容',
                },
                source_filter: {
                    type: 'string',
                    description: '[list] 按来源筛选，如 "西风知识库"',
                },
                limit: {
                    type: 'number',
                    description: '[list/search] 返回最大条数（默认 50）',
                },
            },
            required: ['action'],
        },
    },

    handler: async (args, _workDir) => {
        const action = String(args.action ?? '').trim();

        // ── LIST ────────────────────────────────────────────────────────────
        if (action === 'list') {
            const limit = Number(args.limit ?? 50);
            const rows = nbList({
                sourceFilter: args.source_filter ? String(args.source_filter) : undefined,
                limit,
            });
            if (rows.length === 0) return '笔记本暂无条目。可用 action=add 新增。';
            const lines = rows.map(r => {
                const meta = formatMeta(r);
                const summary = r.summary ? `\n  ${r.summary}` : '';
                return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${summary}`;
            });
            return `笔记本共 ${rows.length} 条（最多显示 ${Math.min(limit, 200)}）：\n\n` + lines.join('\n\n');
        }

        // ── SEARCH ──────────────────────────────────────────────────────────
        if (action === 'search') {
            const query = String(args.query ?? '').trim();
            if (!query) return '[Error] search 需要提供 query 参数';
            const rows = nbSearch(query, Number(args.limit ?? 20));
            if (rows.length === 0) return `未找到包含「${query}」的条目。`;
            const lines = rows.map(r => {
                const meta = formatMeta(r);
                const snip = r.snippet ? `\n  > …${r.snippet}…` : '';
                return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${snip}`;
            });
            return `搜索「${query}」共 ${rows.length} 条：\n\n` + lines.join('\n\n');
        }

        // ── READ ────────────────────────────────────────────────────────────
        if (action === 'read') {
            let row: NotebookEntry | undefined;
            if (args.id != null) {
                row = nbGet(Number(args.id));
            } else if (args.title_query) {
                row = nbGetByTitle(String(args.title_query));
            } else {
                return '[Error] read 需要提供 id 或 title_query';
            }
            if (!row) return '[Error] 未找到对应条目';

            const meta = formatMeta(row);
            const tags = formatTags(row.tags);
            const header = [
                `# ${row.title}`,
                meta,
                row.summary ? `\n**摘要：** ${row.summary}` : '',
                tags.length ? `**标签：** ${tags.join(', ')}` : '',
                `\n---\n`,
            ].filter(Boolean).join('\n');
            return header + (row.content ?? '（无正文）');
        }

        // ── ADD ─────────────────────────────────────────────────────────────
        if (action === 'add') {
            const title = String(args.title ?? '').trim();
            if (!title) return '[Error] add 需要提供 title';
            const tags = Array.isArray(args.tags) ? JSON.stringify(args.tags) : (args.tags ? String(args.tags) : null);
            const entry = nbCreate({
                title,
                author:  args.author  ? String(args.author)  : null,
                date:    args.date    ? String(args.date)    : null,
                source:  args.source  ? String(args.source)  : null,
                summary: args.summary ? String(args.summary) : null,
                tags,
                content: args.content ? String(args.content) : null,
            });
            return `✅ 笔记已添加，ID: ${entry.id}\n标题: ${entry.title}`;
        }

        // ── UPDATE ──────────────────────────────────────────────────────────
        if (action === 'update') {
            if (args.id == null) return '[Error] update 需要提供 id';
            const id = Number(args.id);
            const tags = args.tags != null
                ? (Array.isArray(args.tags) ? JSON.stringify(args.tags) : String(args.tags))
                : undefined;
            const updated = nbUpdate(id, {
                title:   args.title   ? String(args.title)   : undefined,
                author:  args.author  ? String(args.author)  : undefined,
                date:    args.date    ? String(args.date)    : undefined,
                source:  args.source  ? String(args.source)  : undefined,
                summary: args.summary ? String(args.summary) : undefined,
                tags,
                content: args.content ? String(args.content) : undefined,
            });
            if (!updated) return `[Error] 未找到 ID=${id} 的条目`;
            return `✅ 笔记 ID=${id} 已更新`;
        }

        // ── DELETE ──────────────────────────────────────────────────────────
        if (action === 'delete') {
            if (args.id == null) return '[Error] delete 需要提供 id';
            const id = Number(args.id);
            const existing = nbGet(id);
            if (!existing) return `[Error] 未找到 ID=${id} 的条目`;
            nbDelete(id);
            return `✅ 笔记「${existing.title}」(ID=${id}) 已删除`;
        }

        return `[Error] 未知 action: "${action}"`;
    },
};
