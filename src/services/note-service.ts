/**
 * note-service.ts — Business logic for the notes (inbox) table.
 *
 * Notes are quick-capture inbox items scoped to a user_id.
 * The web API uses user_id = 'web'.
 */
import { getDb } from './db.js';
import { jsonParse } from '../utils/json-safe.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NoteRow {
    id: number;
    content: string;
    date: string;
    time: string;
    created_at: number;
    tags: string | null;  // JSON-encoded string[]
}

export interface NoteTag {
    tag: string;
    count: number;
}

export interface NoteHeatmapDay {
    date: string;
    count: number;
}

// ── Operations ───────────────────────────────────────────────────────────────

export function noteList(opts?: { tenantKey?: string; date?: string; tag?: string }): NoteRow[] {
    const db = getDb();
    const tenantKey = opts?.tenantKey ?? 'web';

    if (opts?.tag) {
        // Use SQL JSON filtering to avoid fetching all rows
        return db.prepare(
            `SELECT id, content, date, time, created_at, tags
             FROM notes WHERE user_id = ? AND tags LIKE ? ORDER BY created_at DESC LIMIT 200`
        ).all(tenantKey, `%${JSON.stringify(opts.tag).slice(1, -1)}%`) as NoteRow[];
    }

    if (opts?.date) {
        return db.prepare(
            `SELECT id, content, date, time, created_at, tags
             FROM notes WHERE user_id = ? AND date = ? ORDER BY created_at DESC`
        ).all(tenantKey, opts.date) as NoteRow[];
    }

    return db.prepare(
        `SELECT id, content, date, time, created_at, tags
         FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`
    ).all(tenantKey) as NoteRow[];
}

export function noteStats(tenantKey = 'web'): NoteHeatmapDay[] {
    return getDb().prepare(
        `SELECT date, COUNT(*) as count FROM notes WHERE user_id = ? GROUP BY date ORDER BY date`
    ).all(tenantKey) as NoteHeatmapDay[];
}

export function noteTags(tenantKey = 'web'): NoteTag[] {
    const rows = getDb().prepare(
        `SELECT tags FROM notes WHERE user_id = ? AND tags IS NOT NULL AND tags != '[]'`
    ).all(tenantKey) as Array<{ tags: string }>;

    const tagCount = new Map<string, number>();
    for (const row of rows) {
        try {
            for (const t of jsonParse<string[]>(row.tags, [])) {
                tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
            }
        } catch { /* skip malformed */ }
    }
    return Array.from(tagCount.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
}

export function noteCreate(content: string, tags?: string[] | null, tenantKey = 'web'): NoteRow {
    const db = getDb();
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].slice(0, 5);
    const createdAt = now.getTime();
    const tagsJson = tags?.length ? JSON.stringify(tags) : null;

    const result = db.prepare(
        `INSERT INTO notes (user_id, content, date, time, created_at, tags) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(tenantKey, content, date, time, createdAt, tagsJson);

    return { id: result.lastInsertRowid as number, content, date, time, created_at: createdAt, tags: tagsJson };
}

export function noteDelete(id: number, tenantKey = 'web'): boolean {
    const result = getDb().prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, tenantKey);
    return result.changes > 0;
}
