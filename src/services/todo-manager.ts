/**
 * todo-manager.ts — Unified todo / reminder / scheduled-task manager.
 *
 * Merges three previously separate concepts into a single `Todo` model:
 *
 * | fireAt | cronExpr | prompt | Behaviour                              |
 * |--------|----------|--------|----------------------------------------|
 * |   ✗    |    ✗     |   ✗    | Plain todo item                        |
 * |   ✓    |    ✗     |   ✗    | One-time reminder (notification only)  |
 * |   ✓    |    ✗     |   ✓    | One-time scheduled task (AI executes)  |
 * |   ✗    |    ✓     |   ✓    | Recurring scheduled task (cron-based)  |
 *
 * Data lives in the `todos_v2` table.  The manager handles both a 30-second
 * interval poll (one-time fire_at items) and node-cron jobs (recurring items).
 */

import type Database from 'better-sqlite3';
import cron, { ScheduledTask as CronJob } from 'node-cron';

// ── Types ────────────────────────────────────────────────────────────────────

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface Todo {
    id: string;
    content: string;
    status: TodoStatus;
    priority: string | null;
    /** Optional AI instruction executed when the todo fires */
    prompt: string | null;
    /** One-time trigger (unix ms). Null for plain todos / recurring items. */
    fireAt: number | null;
    /** Cron expression for recurring execution. Null for plain / one-time items. */
    cronExpr: string | null;
    /** Has the one-time trigger already fired? */
    fired: boolean;
    /** Is the recurring cron job active? */
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface TodoCreateInput {
    content: string;
    status?: TodoStatus;
    priority?: string | null;
    prompt?: string | null;
    fireAt?: number | null;
    cronExpr?: string | null;
}

export interface TodoPatchInput {
    content?: string;
    status?: TodoStatus;
    priority?: string | null;
    prompt?: string | null;
    fireAt?: number | null;
    cronExpr?: string | null;
    enabled?: boolean;
}

/** Callback for one-time reminders / tasks that reach their fire_at time. */
export type FireCallback = (todo: Todo) => Promise<void>;

/** Callback for recurring cron-based tasks. */
export type CronCallback = (todo: Todo) => Promise<void>;

// ── Manager ──────────────────────────────────────────────────────────────────

export class TodoManager {
    private db: Database.Database;
    private scopeKey: string;
    private timer: NodeJS.Timeout | null = null;
    private cronJobs = new Map<string, CronJob>();
    private onFire?: FireCallback;
    private onCron?: CronCallback;

    constructor(db: Database.Database, scopeKey: string) {
        this.db = db;
        this.scopeKey = scopeKey;
    }

    /**
     * Initialise the manager: restore cron jobs, start the one-time poll timer.
     *
     * @param onFire  Called when a one-time `fireAt` todo is due.
     * @param onCron  Called each time a recurring `cronExpr` todo triggers.
     */
    async init(onFire: FireCallback, onCron: CronCallback): Promise<void> {
        this.onFire = onFire;
        this.onCron = onCron;

        // Restore recurring cron jobs
        const recurring = this.db.prepare(
            `SELECT * FROM todos_v2 WHERE scope_key = ? AND cron_expr IS NOT NULL AND enabled = 1`
        ).all(this.scopeKey) as RawRow[];
        for (const row of recurring) {
            this.scheduleCronJob(this.rowToTodo(row));
        }

        const pendingCount = (this.db.prepare(
            `SELECT COUNT(*) as n FROM todos_v2 WHERE scope_key = ? AND fire_at IS NOT NULL AND fired = 0`
        ).get(this.scopeKey) as { n: number }).n;

        console.log(`[TodoManager|${this.scopeKey}] Ready (${pendingCount} pending fire(s), ${recurring.length} cron job(s)).`);

        // Poll for one-time fire_at items every 30s
        this.timer = setInterval(() => this.tick(), 30_000);
    }

    // ── CRUD ─────────────────────────────────────────────────────────────

    add(input: TodoCreateInput): Todo {
        const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const now = Date.now();
        const status = input.status ?? 'pending';
        const priority = input.priority ?? null;
        const prompt = input.prompt ?? null;
        const fireAt = input.fireAt ?? null;
        const cronExpr = input.cronExpr ?? null;
        const enabled = cronExpr ? 1 : 0;

        this.db.prepare(
            `INSERT INTO todos_v2 (id, scope_key, content, status, priority, prompt, fire_at, cron_expr, fired, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
        ).run(id, this.scopeKey, input.content, status, priority, prompt, fireAt, cronExpr, enabled, now, now);

        const todo: Todo = {
            id, content: input.content, status, priority,
            prompt, fireAt, cronExpr,
            fired: false, enabled: !!enabled,
            createdAt: now, updatedAt: now,
        };

        if (cronExpr) this.scheduleCronJob(todo);

        const label = cronExpr ? `cron(${cronExpr})` : fireAt ? `fire@${new Date(fireAt).toISOString()}` : 'plain';
        console.log(`[TodoManager|${this.scopeKey}] Added #${id} [${label}]: ${input.content}`);
        return todo;
    }

    patch(id: string, patch: TodoPatchInput): boolean {
        const now = Date.now();
        const existing = this.db.prepare(
            `SELECT * FROM todos_v2 WHERE id = ? AND scope_key = ?`
        ).get(id, this.scopeKey) as RawRow | undefined;
        if (!existing) return false;

        const sets: string[] = ['updated_at = ?'];
        const params: unknown[] = [now];

        if (patch.content !== undefined) { sets.push('content = ?'); params.push(patch.content); }
        if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
        if (patch.priority !== undefined) { sets.push('priority = ?'); params.push(patch.priority); }
        if (patch.prompt !== undefined) { sets.push('prompt = ?'); params.push(patch.prompt); }
        if (patch.fireAt !== undefined) { sets.push('fire_at = ?'); params.push(patch.fireAt); }
        if (patch.cronExpr !== undefined) { sets.push('cron_expr = ?'); params.push(patch.cronExpr); }
        if (patch.enabled !== undefined) { sets.push('enabled = ?'); params.push(patch.enabled ? 1 : 0); }

        params.push(id, this.scopeKey);
        this.db.prepare(`UPDATE todos_v2 SET ${sets.join(', ')} WHERE id = ? AND scope_key = ?`).run(...params);

        // Reschedule cron if cron_expr or enabled changed
        if (patch.cronExpr !== undefined || patch.enabled !== undefined) {
            this.stopCronJob(id);
            const updated = this.getById(id);
            if (updated && updated.cronExpr && updated.enabled) {
                this.scheduleCronJob(updated);
            }
        }

        return true;
    }

    delete(id: string): boolean {
        this.stopCronJob(id);
        const result = this.db.prepare(
            `DELETE FROM todos_v2 WHERE id = ? AND scope_key = ?`
        ).run(id, this.scopeKey);
        return result.changes > 0;
    }

    // ── Queries ──────────────────────────────────────────────────────────

    getById(id: string): Todo | null {
        const row = this.db.prepare(
            `SELECT * FROM todos_v2 WHERE id = ? AND scope_key = ?`
        ).get(id, this.scopeKey) as RawRow | undefined;
        return row ? this.rowToTodo(row) : null;
    }

    /** All non-fired one-time (fire_at) items. */
    getReminders(): Todo[] {
        return (this.db.prepare(
            `SELECT * FROM todos_v2 WHERE scope_key = ? AND fire_at IS NOT NULL AND fired = 0 ORDER BY fire_at ASC`
        ).all(this.scopeKey) as RawRow[]).map(r => this.rowToTodo(r));
    }

    /** All enabled recurring (cron_expr) items. */
    getSchedules(): Todo[] {
        return (this.db.prepare(
            `SELECT * FROM todos_v2 WHERE scope_key = ? AND cron_expr IS NOT NULL AND enabled = 1 ORDER BY created_at ASC`
        ).all(this.scopeKey) as RawRow[]).map(r => this.rowToTodo(r));
    }

    /** All plain todos (no fire_at, no cron_expr). */
    getTodos(): Todo[] {
        return (this.db.prepare(
            `SELECT * FROM todos_v2 WHERE scope_key = ? AND fire_at IS NULL AND cron_expr IS NULL ORDER BY created_at ASC`
        ).all(this.scopeKey) as RawRow[]).map(r => this.rowToTodo(r));
    }

    /** All items regardless of type. */
    getAll(): Todo[] {
        return (this.db.prepare(
            `SELECT * FROM todos_v2 WHERE scope_key = ? ORDER BY created_at ASC`
        ).all(this.scopeKey) as RawRow[]).map(r => this.rowToTodo(r));
    }

    /** Delete all done plain todos. Returns count deleted. */
    clearDone(): number {
        return this.db.prepare(
            `DELETE FROM todos_v2 WHERE scope_key = ? AND status = 'done' AND fire_at IS NULL AND cron_expr IS NULL`
        ).run(this.scopeKey).changes;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    destroy(): void {
        if (this.timer) clearInterval(this.timer);
        for (const job of this.cronJobs.values()) job.stop();
        this.cronJobs.clear();
    }

    // ── Internal: one-time fire poll ─────────────────────────────────────

    private async tick(): Promise<void> {
        const now = Date.now();
        const due = this.db.prepare(
            `SELECT * FROM todos_v2 WHERE scope_key = ? AND fire_at IS NOT NULL AND fired = 0 AND fire_at <= ?`
        ).all(this.scopeKey, now) as RawRow[];

        for (const row of due) {
            this.db.prepare(`UPDATE todos_v2 SET fired = 1, status = 'done', updated_at = ? WHERE id = ?`).run(now, row.id);
            const todo = this.rowToTodo({ ...row, fired: 1, status: 'done' });
            try {
                await this.onFire?.(todo);
            } catch (err: any) {
                console.error(`[TodoManager] Fire error for #${row.id}:`, err.message);
            }
        }
    }

    // ── Internal: cron jobs ──────────────────────────────────────────────

    private scheduleCronJob(todo: Todo): void {
        if (!todo.cronExpr) return;
        const job = cron.schedule(todo.cronExpr, async () => {
            console.log(`[TodoManager] Cron #${todo.id}: ${todo.content}`);
            try {
                await this.onCron?.(todo);
            } catch (err: any) {
                console.error(`[TodoManager] Cron error for #${todo.id}:`, err.message);
            }
        }, { timezone: 'Asia/Shanghai' });
        this.cronJobs.set(todo.id, job);
    }

    private stopCronJob(id: string): void {
        const job = this.cronJobs.get(id);
        if (job) {
            job.stop();
            this.cronJobs.delete(id);
        }
    }

    // ── Internal: row mapping ────────────────────────────────────────────

    private rowToTodo(row: RawRow): Todo {
        return {
            id: row.id,
            content: row.content,
            status: row.status as TodoStatus,
            priority: row.priority ?? null,
            prompt: row.prompt ?? null,
            fireAt: row.fire_at ?? null,
            cronExpr: row.cron_expr ?? null,
            fired: !!row.fired,
            enabled: !!row.enabled,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

// ── Raw DB row ───────────────────────────────────────────────────────────────

interface RawRow {
    id: string;
    scope_key: string;
    content: string;
    status: string;
    priority: string | null;
    prompt: string | null;
    fire_at: number | null;
    cron_expr: string | null;
    fired: number;
    enabled: number;
    created_at: number;
    updated_at: number;
}
