/**
 * task-service.ts — Business logic for the tasks table.
 *
 * Tasks are quick-capture action items scoped to a tenant_key.
 */
import { getDb } from './db.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskRow {
    id: string;
    content: string;
    status: string;
    date: string;
    time: string;
    created_at: number;
}

// ── Operations ───────────────────────────────────────────────────────────────

export function taskCreate(content: string, tenantKey: string): TaskRow {
    const db = getDb();
    const now = new Date();
    const date = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const time = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
    const createdAt = now.getTime();
    const id = Math.random().toString(36).slice(2, 10);

    db.prepare(
        `INSERT INTO tasks (id, tenant_key, content, status, date, time, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?)`
    ).run(id, tenantKey, content, date, time, createdAt);

    return { id, content, status: 'open', date, time, created_at: createdAt };
}

export function taskList(opts?: { tenantKey?: string; status?: string; date?: string }): TaskRow[] {
    const db = getDb();
    const tenantKey = opts?.tenantKey ?? 'web';

    const conditions: string[] = ['tenant_key = ?'];
    const params: unknown[] = [tenantKey];

    if (opts?.status) {
        conditions.push('status = ?');
        params.push(opts.status);
    }
    if (opts?.date) {
        conditions.push('date = ?');
        params.push(opts.date);
    }

    return db.prepare(
        `SELECT id, content, status, date, time, created_at FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
    ).all(...params) as TaskRow[];
}
