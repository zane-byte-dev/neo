/**
 * todo-service.ts — Business logic for the todos table.
 *
 * Two consumers share this table with different conventions:
 *   • AI tool (todo_write): tenant_key from context, statuses: pending/in_progress/done/blocked
 *   • Web API:              tenant_key = 'web',       statuses: not-started/completed
 */
import { getDb } from './db.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TodoRow {
    id: string;
    content: string;
    status: string;
    priority: string | null;
    remind_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TodoCreateInput {
    content: string;
    status?: string;
    priority?: string | null;
    remind_at?: string | null;
    tenantKey?: string;
}

export interface TodoPatch {
    content?: string;
    status?: string;
    priority?: string | null;
    remind_at?: string | null;
}

// ── Operations ───────────────────────────────────────────────────────────────

export function todoList(tenantKey: string): TodoRow[] {
    return getDb().prepare(
        `SELECT id, content, status, priority, remind_at, created_at, updated_at
         FROM todos
         WHERE tenant_key = ?
         ORDER BY
           CASE status WHEN 'not-started' THEN 0 WHEN 'pending' THEN 0 ELSE 1 END,
           remind_at ASC NULLS LAST,
           created_at DESC`
    ).all(tenantKey) as TodoRow[];
}

export function todoListByStatus(tenantKey: string): TodoRow[] {
    return getDb().prepare(
        `SELECT id, content, status, priority, created_at, updated_at
         FROM todos WHERE tenant_key = ? ORDER BY created_at ASC`
    ).all(tenantKey) as TodoRow[];
}

export function todoCreate(input: TodoCreateInput): TodoRow {
    const db = getDb();
    const id = Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();
    const tenantKey = input.tenantKey ?? 'web';
    const status = input.status ?? 'not-started';
    const priority = input.priority ?? null;
    const remindAt = input.remind_at ?? null;

    db.prepare(
        `INSERT INTO todos (id, tenant_key, content, status, priority, remind_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, tenantKey, input.content, status, priority, remindAt, now, now);

    return { id, content: input.content, status, priority, remind_at: remindAt, created_at: now, updated_at: now };
}

export function todoPatch(id: string, patch: TodoPatch, tenantKey?: string): boolean {
    const db = getDb();
    const now = new Date().toISOString();
    let changed = false;

    if (patch.status !== undefined) {
        const result = tenantKey
            ? db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ? AND tenant_key = ?').run(patch.status, now, id, tenantKey)
            : db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?').run(patch.status, now, id);
        if (result.changes === 0) return false;
        changed = true;
    }
    if (patch.content !== undefined) {
        const q = tenantKey
            ? db.prepare('UPDATE todos SET content = ?, updated_at = ? WHERE id = ? AND tenant_key = ?')
            : db.prepare('UPDATE todos SET content = ?, updated_at = ? WHERE id = ?');
        tenantKey ? q.run(patch.content, now, id, tenantKey) : q.run(patch.content, now, id);
        changed = true;
    }
    if (patch.remind_at !== undefined) {
        const q = tenantKey
            ? db.prepare('UPDATE todos SET remind_at = ?, updated_at = ? WHERE id = ? AND tenant_key = ?')
            : db.prepare('UPDATE todos SET remind_at = ?, updated_at = ? WHERE id = ?');
        tenantKey ? q.run(patch.remind_at, now, id, tenantKey) : q.run(patch.remind_at, now, id);
        changed = true;
    }
    if (patch.priority !== undefined) {
        const q = tenantKey
            ? db.prepare('UPDATE todos SET priority = ?, updated_at = ? WHERE id = ? AND tenant_key = ?')
            : db.prepare('UPDATE todos SET priority = ?, updated_at = ? WHERE id = ?');
        tenantKey ? q.run(patch.priority, now, id, tenantKey) : q.run(patch.priority, now, id);
        changed = true;
    }
    return changed;
}

export function todoDelete(id: string, tenantKey?: string): boolean {
    const result = tenantKey
        ? getDb().prepare('DELETE FROM todos WHERE id = ? AND tenant_key = ?').run(id, tenantKey)
        : getDb().prepare('DELETE FROM todos WHERE id = ?').run(id);
    return result.changes > 0;
}

export function todoDeleteDone(tenantKey: string): number {
    return getDb().prepare(
        `DELETE FROM todos WHERE tenant_key = ? AND status = 'done'`
    ).run(tenantKey).changes;
}
