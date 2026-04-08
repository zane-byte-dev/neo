/**
 * notebook.ts — AI tool for reading and writing the notebook knowledge base.
 *
 * Backed by SQLite (notebook_entries table) with FTS5 full-text search.
 * Replaces the old find_in_km file-based tool.
 *
 * Actions:
 *   list   — list all entries (title, id, date, source, tags, summary)
 *   search — full-text search via FTS5
 *   read   — get full content by id or title substring
 *   add    — create a new notebook entry
 *   update — update an existing entry by id
 *   delete — delete an entry by id
 */
import { getDb } from '../services/db.js';
import type { Tool } from './_base.js';

interface NoteRow {
    id: number;
    title: string;
    author: string | null;
    date: string | null;
    source: string | null;
    summary: string | null;
    tags: string | null;
    content: string | null;
    created_at: string;
    updated_at: string;
}

function formatTags(raw: string | null): string[] {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return [raw]; }
}

function formatMeta(row: NoteRow): string {
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
        const db = getDb();
        const now = new Date().toISOString();

        // ── LIST ────────────────────────────────────────────────────────────
        if (action === 'list') {
            const limit = Math.min(Number(args.limit ?? 50), 200);
            const rows = args.source_filter
                ? db.prepare(
                      'SELECT id, title, author, date, source, tags, summary FROM notebook_entries WHERE source = ? ORDER BY date DESC LIMIT ?'
                  ).all(String(args.source_filter), limit) as NoteRow[]
                : db.prepare(
                      'SELECT id, title, author, date, source, tags, summary FROM notebook_entries ORDER BY date DESC LIMIT ?'
                  ).all(limit) as NoteRow[];

            if (rows.length === 0) return '笔记本暂无条目。可用 action=add 新增。';

            const lines = rows.map(r => {
                const meta = formatMeta(r);
                const summary = r.summary ? `\n  ${r.summary}` : '';
                return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${summary}`;
            });
            return `笔记本共 ${rows.length} 条（最多显示 ${limit}）：\n\n` + lines.join('\n\n');
        }

        // ── SEARCH ──────────────────────────────────────────────────────────
        if (action === 'search') {
            const query = String(args.query ?? '').trim();
            if (!query) return '[Error] search 需要提供 query 参数';
            const limit = Math.min(Number(args.limit ?? 20), 100);

            let rows: NoteRow[];
            try {
                rows = db.prepare(`
                    SELECT n.id, n.title, n.author, n.date, n.source, n.tags, n.summary,
                           snippet(notebook_fts, 5, '**', '**', '…', 32) AS snippet
                    FROM notebook_fts
                    JOIN notebook_entries n ON n.id = notebook_fts.rowid
                    WHERE notebook_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                `).all(query, limit) as (NoteRow & { snippet: string })[];
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                return `[Error] 搜索失败: ${msg}`;
            }

            if (rows.length === 0) return `未找到包含「${query}」的条目。`;

            const lines = rows.map((r: NoteRow & { snippet?: string }) => {
                const meta = formatMeta(r);
                const snip = r.snippet ? `\n  > …${r.snippet}…` : '';
                return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${snip}`;
            });
            return `搜索「${query}」共 ${rows.length} 条：\n\n` + lines.join('\n\n');
        }

        // ── READ ────────────────────────────────────────────────────────────
        if (action === 'read') {
            let row: NoteRow | undefined;
            if (args.id != null) {
                row = db.prepare('SELECT * FROM notebook_entries WHERE id = ?').get(Number(args.id)) as NoteRow | undefined;
            } else if (args.title_query) {
                const q = `%${String(args.title_query)}%`;
                row = db.prepare('SELECT * FROM notebook_entries WHERE title LIKE ? ORDER BY date DESC LIMIT 1').get(q) as NoteRow | undefined;
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

            const result = db.prepare(`
                INSERT INTO notebook_entries (title, author, date, source, summary, tags, content, created_at, updated_at)
                VALUES (@title, @author, @date, @source, @summary, @tags, @content, @created_at, @updated_at)
            `).run({
                title,
                author:     args.author ? String(args.author) : null,
                date:       args.date   ? String(args.date)   : null,
                source:     args.source ? String(args.source) : null,
                summary:    args.summary ? String(args.summary) : null,
                tags,
                content:    args.content ? String(args.content) : null,
                created_at: now,
                updated_at: now,
            });

            return `✅ 笔记已添加，ID: ${result.lastInsertRowid}\n标题: ${title}`;
        }

        // ── UPDATE ──────────────────────────────────────────────────────────
        if (action === 'update') {
            if (args.id == null) return '[Error] update 需要提供 id';
            const id = Number(args.id);
            const existing = db.prepare('SELECT * FROM notebook_entries WHERE id = ?').get(id) as NoteRow | undefined;
            if (!existing) return `[Error] 未找到 ID=${id} 的条目`;

            const tags = args.tags != null
                ? (Array.isArray(args.tags) ? JSON.stringify(args.tags) : String(args.tags))
                : existing.tags;

            db.prepare(`
                UPDATE notebook_entries SET
                    title      = @title,
                    author     = @author,
                    date       = @date,
                    source     = @source,
                    summary    = @summary,
                    tags       = @tags,
                    content    = @content,
                    updated_at = @updated_at
                WHERE id = @id
            `).run({
                id,
                title:      args.title   ? String(args.title)   : existing.title,
                author:     args.author  ? String(args.author)  : existing.author,
                date:       args.date    ? String(args.date)    : existing.date,
                source:     args.source  ? String(args.source)  : existing.source,
                summary:    args.summary ? String(args.summary) : existing.summary,
                tags,
                content:    args.content ? String(args.content) : existing.content,
                updated_at: now,
            });

            return `✅ 笔记 ID=${id} 已更新`;
        }

        // ── DELETE ──────────────────────────────────────────────────────────
        if (action === 'delete') {
            if (args.id == null) return '[Error] delete 需要提供 id';
            const id = Number(args.id);
            const existing = db.prepare('SELECT title FROM notebook_entries WHERE id = ?').get(id) as { title: string } | undefined;
            if (!existing) return `[Error] 未找到 ID=${id} 的条目`;

            db.prepare('DELETE FROM notebook_entries WHERE id = ?').run(id);
            return `✅ 笔记「${existing.title}」(ID=${id}) 已删除`;
        }

        return `[Error] 未知 action: "${action}"`;
    },
};
