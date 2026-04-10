/**
 * notebook-service.ts — Business logic for the notebook knowledge base.
 *
 * Single source of truth for all notebook CRUD operations.
 * Used by both the AI tool (tools/workspace/notebook.ts) and the web API routes.
 */
import { getDb } from './db.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NotebookEntry {
    id: number;
    title: string;
    author: string | null;
    date: string | null;
    source: string | null;
    summary: string | null;
    tags: string | null;   // JSON-encoded string[]
    content: string | null;
    created_at: string;
    updated_at: string;
}

export type NotebookEntryPartial = Omit<NotebookEntry, 'content' | 'created_at' | 'updated_at'>;

export interface NotebookSearchResult extends NotebookEntryPartial {
    snippet?: string;
}

export interface NotebookCreateInput {
    title: string;
    author?: string | null;
    date?: string | null;
    source?: string | null;
    summary?: string | null;
    tags?: string | null;   // JSON-encoded string[]
    content?: string | null;
}

export type NotebookUpdateInput = Partial<Omit<NotebookCreateInput, 'title'>> & { title?: string };

// ── Operations ───────────────────────────────────────────────────────────────

export function nbList(opts?: { sourceFilter?: string; limit?: number }): NotebookEntryPartial[] {
    const db = getDb();
    const limit = Math.min(opts?.limit ?? 50, 200);
    if (opts?.sourceFilter) {
        return db.prepare(
            `SELECT id, title, author, date, source, tags, summary
             FROM notebook_entries WHERE source = ? ORDER BY date DESC, id DESC LIMIT ?`
        ).all(opts.sourceFilter, limit) as NotebookEntryPartial[];
    }
    return db.prepare(
        `SELECT id, title, author, date, source, tags, summary
         FROM notebook_entries ORDER BY date DESC, id DESC LIMIT ?`
    ).all(limit) as NotebookEntryPartial[];
}

export function nbSearch(query: string, limit = 20): NotebookSearchResult[] {
    const db = getDb();
    const cap = Math.min(limit, 100);
    try {
        return db.prepare(`
            SELECT n.id, n.title, n.author, n.date, n.source, n.tags, n.summary,
                   snippet(notebook_fts, 5, '**', '**', '…', 32) AS snippet
            FROM notebook_fts
            JOIN notebook_entries n ON n.id = notebook_fts.rowid
            WHERE notebook_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(query, cap) as NotebookSearchResult[];
    } catch {
        // Fallback to LIKE when FTS query syntax is invalid
        return db.prepare(
            `SELECT id, title, author, date, source, tags, summary
             FROM notebook_entries WHERE title LIKE ? OR content LIKE ?
             LIMIT ?`
        ).all(`%${query}%`, `%${query}%`, cap) as NotebookSearchResult[];
    }
}

export function nbGet(id: number): NotebookEntry | undefined {
    return getDb().prepare(
        'SELECT * FROM notebook_entries WHERE id = ?'
    ).get(id) as NotebookEntry | undefined;
}

export function nbGetByTitle(titleQuery: string): NotebookEntry | undefined {
    return getDb().prepare(
        'SELECT * FROM notebook_entries WHERE title LIKE ? ORDER BY date DESC LIMIT 1'
    ).get(`%${titleQuery}%`) as NotebookEntry | undefined;
}

export function nbCreate(data: NotebookCreateInput): NotebookEntry {
    const db = getDb();
    const now = new Date().toISOString();
    const title   = data.title.trim();
    const author  = data.author?.trim()  || null;
    const date    = data.date?.trim()    || null;
    const source  = data.source?.trim()  || null;
    const summary = data.summary?.trim() || null;
    const tags    = data.tags?.trim()    || null;
    const content = data.content ?? null;

    const result = db.prepare(
        `INSERT INTO notebook_entries (title, author, date, source, summary, tags, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(title, author, date, source, summary, tags, content, now, now);

    return { id: result.lastInsertRowid as number, title, author, date, source, summary, tags, content, created_at: now, updated_at: now };
}

export function nbUpdate(id: number, data: NotebookUpdateInput): NotebookEntry | undefined {
    const db = getDb();
    const existing = nbGet(id);
    if (!existing) return undefined;

    const now     = new Date().toISOString();
    const title   = data.title   !== undefined ? (data.title.trim()   || existing.title)   : existing.title;
    const author  = data.author  !== undefined ? (data.author?.trim() || null)              : existing.author;
    const date    = data.date    !== undefined ? (data.date?.trim()   || null)              : existing.date;
    const source  = data.source  !== undefined ? (data.source?.trim() || null)              : existing.source;
    const summary = data.summary !== undefined ? (data.summary?.trim()|| null)              : existing.summary;
    const tags    = data.tags    !== undefined ? (data.tags?.trim()   || null)              : existing.tags;
    const content = data.content !== undefined ? data.content                               : existing.content;

    db.prepare(
        `UPDATE notebook_entries SET title=?, author=?, date=?, source=?, summary=?, tags=?, content=?, updated_at=? WHERE id=?`
    ).run(title, author, date, source, summary, tags, content, now, id);

    return { ...existing, title, author, date, source, summary, tags, content, updated_at: now };
}

export function nbDelete(id: number): boolean {
    const result = getDb().prepare('DELETE FROM notebook_entries WHERE id = ?').run(id);
    return result.changes > 0;
}
