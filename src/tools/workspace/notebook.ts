/**
 * notebook.ts — AI tool for reading and writing the notebook knowledge base.
 *
 * Backed by the file system: {workDir}/notebooks/{notebookName}/*.md
 * All operations are delegated to notebook-service.ts.
 *
 * Actions:
 *   notebooks — list all available notebooks
 *   list      — list entries in one or all notebooks
 *   search    — full-text search
 *   read      — get full content by id or title substring
 *   add       — create a new entry (specify notebook)
 *   update    — update an existing entry by id
 *   delete    — delete an entry by id
 */
import type { Tool } from '../_base.js';
import type { NotebookEntryPartial, NotebookEntry } from '../../services/notebook-service.js';
import { nbListNotebooks, nbList, nbSearch, nbGet, nbGetByTitle, nbCreate, nbUpdate, nbDelete } from '../../services/notebook-service.js';

function formatTags(raw: string | null): string[] {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return [raw]; }
}

function formatMeta(r: NotebookEntryPartial): string {
    const parts: string[] = [];
    if (r.date)    parts.push(`📅 ${r.date}`);
    if (r.author)  parts.push(`✍️ ${r.author}`);
    if (r.source)  parts.push(`📌 ${r.source}`);
    const tags = formatTags(r.tags);
    if (tags.length) parts.push(`🏷️ ${tags.join(', ')}`);
    return parts.join('  ');
}

export const notebookTool: Tool = {
    meta: { category: 'knowledge', version: '2.0.0' },
    declaration: {
        name: 'notebook',
        description:
            '操作文件系统知识库（{workDir}/notebooks/）。\n' +
            '• action=notebooks — 列出所有 notebook 名称\n' +
            '• action=list      — 列出条目（可按 notebook 筛选）\n' +
            '• action=search    — 全文搜索\n' +
            '• action=read      — 按 id 或标题关键词读取完整内容\n' +
            '• action=add       — 新增条目（必须指定 notebook）\n' +
            '• action=update    — 更新条目（按 id）\n' +
            '• action=delete    — 删除条目（按 id）',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['notebooks', 'list', 'search', 'read', 'add', 'update', 'delete'],
                    description: '操作类型',
                },
                notebook: {
                    type: 'string',
                    description: '[list/search/add] notebook 名称，如 "xifeng"、"personal"',
                },
                query: {
                    type: 'string',
                    description: '[search] 搜索关键词',
                },
                id: {
                    type: 'string',
                    description: '[read/update/delete] 条目 ID，格式 "notebook/filename.md"',
                },
                title_query: {
                    type: 'string',
                    description: '[read] 按标题关键词查找（模糊匹配，id 优先）',
                },
                title:   { type: 'string', description: '[add/update] 标题' },
                author:  { type: 'string', description: '[add/update] 作者' },
                date:    { type: 'string', description: '[add/update] 日期，如 "2024-03-09"' },
                source:  { type: 'string', description: '[add/update] 来源' },
                summary: { type: 'string', description: '[add/update] 摘要/核心观点' },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '[add/update] 标签列表',
                },
                content: { type: 'string', description: '[add/update] 正文内容' },
                limit:   { type: 'number', description: '[list/search] 返回最大条数（默认 50）' },
            },
            required: ['action'],
        },
    },

    handler: async (args, workDir) => {
        const action = String(args.action ?? '').trim();

        // ── NOTEBOOKS ────────────────────────────────────────────────────────
        if (action === 'notebooks') {
            const nbs = nbListNotebooks(workDir);
            if (nbs.length === 0) return '没有找到任何 notebook（notebooks/ 目录为空或不存在）';
            return `共 ${nbs.length} 个 notebook：\n${nbs.map(n => `• ${n}`).join('\n')}`;
        }

        // ── LIST ────────────────────────────────────────────────────────────
        if (action === 'list') {
            const limit = Number(args.limit ?? 50);
            const nb = args.notebook ? String(args.notebook) : undefined;
            const rows = nbList(workDir, { notebook: nb, limit });
            if (rows.length === 0) return nb ? `notebook "${nb}" 暂无条目` : '没有找到任何条目';
            const prefix = nb ? `notebook「${nb}」` : '全部 notebook';
            const lines = rows.map(r => {
                const meta = formatMeta(r);
                const summary = r.summary ? `\n  ${r.summary}` : '';
                return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${summary}`;
            });
            return `${prefix}共 ${rows.length} 条：\n\n` + lines.join('\n\n');
        }

        // ── SEARCH ──────────────────────────────────────────────────────────
        if (action === 'search') {
            const query = String(args.query ?? '').trim();
            if (!query) return '[Error] search 需要提供 query 参数';
            const nb = args.notebook ? String(args.notebook) : undefined;
            const rows = nbSearch(workDir, query, { notebook: nb, limit: Number(args.limit ?? 20) });
            if (rows.length === 0) return `未找到包含「${query}」的条目。`;
            const lines = rows.map(r => {
                const meta = formatMeta(r);
                const snip = r.snippet ? `\n  > ${r.snippet}` : '';
                return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${snip}`;
            });
            return `搜索「${query}」共 ${rows.length} 条：\n\n` + lines.join('\n\n');
        }

        // ── READ ────────────────────────────────────────────────────────────
        if (action === 'read') {
            let row: NotebookEntry | undefined;
            if (args.id != null) {
                row = nbGet(workDir, String(args.id));
            } else if (args.title_query) {
                const nb = args.notebook ? String(args.notebook) : undefined;
                row = nbGetByTitle(workDir, String(args.title_query), nb);
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
            const nb = String(args.notebook ?? 'personal');
            const tags = Array.isArray(args.tags) ? JSON.stringify(args.tags) : (args.tags ? String(args.tags) : null);
            const entry = nbCreate(workDir, nb, {
                title,
                author:  args.author  ? String(args.author)  : null,
                date:    args.date    ? String(args.date)    : null,
                source:  args.source  ? String(args.source)  : null,
                summary: args.summary ? String(args.summary) : null,
                tags,
                content: args.content ? String(args.content) : null,
            });
            return `✅ 笔记已添加到 "${nb}"\nID: ${entry.id}\n标题: ${entry.title}`;
        }

        // ── UPDATE ──────────────────────────────────────────────────────────
        if (action === 'update') {
            if (args.id == null) return '[Error] update 需要提供 id';
            const id = String(args.id);
            const tags = args.tags != null
                ? (Array.isArray(args.tags) ? JSON.stringify(args.tags) : String(args.tags))
                : undefined;
            const updated = nbUpdate(workDir, id, {
                title:   args.title   ? String(args.title)   : undefined,
                author:  args.author  ? String(args.author)  : undefined,
                date:    args.date    ? String(args.date)    : undefined,
                source:  args.source  ? String(args.source)  : undefined,
                summary: args.summary ? String(args.summary) : undefined,
                tags,
                content: args.content != null ? String(args.content) : undefined,
            });
            if (!updated) return `[Error] 未找到 id="${id}" 的条目`;
            return `✅ 笔记已更新：${updated.title}`;
        }

        // ── DELETE ──────────────────────────────────────────────────────────
        if (action === 'delete') {
            if (args.id == null) return '[Error] delete 需要提供 id';
            const id = String(args.id);
            const existing = nbGet(workDir, id);
            if (!existing) return `[Error] 未找到 id="${id}" 的条目`;
            nbDelete(workDir, id);
            return `✅ 笔记「${existing.title}」已删除`;
        }

        return `[Error] 未知 action: "${action}"`;
    },
};

