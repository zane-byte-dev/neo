import type Database from 'better-sqlite3';
import type { TenantKey } from '../types/platform.js';
import PQueue from 'p-queue';
import { getDb } from './db.js';

export interface QueuedTask {
    id: string;
    sessionId: string;
    question: string;
    userName: string;
    messageId: string;
    status: 'pending' | 'processing' | 'done';
    createdAt: number;
}

/**
 * Persistent message queue backed by SQLite.
 * Tasks survive bot restarts — on init(), unfinished tasks are returned for replay.
 * 'done' tasks are deleted immediately (no accumulation).
 */
export class MessageQueue {
    private pqueue = new PQueue({ concurrency: 1 });
    private db: Database.Database;
    private userId: TenantKey;

    constructor(tenantKey: TenantKey) {
        this.db = getDb();
        this.userId = tenantKey;
    }

    /**
     * Load unfinished tasks from DB.
     * Returns them sorted by creation time for replay.
     * Tasks previously stuck in 'processing' are reset to 'pending'.
     */
    async init(): Promise<QueuedTask[]> {
        // Reset any stuck 'processing' tasks to 'pending'
        this.db.prepare(
            `UPDATE message_queue SET status = 'pending' WHERE user_id = ? AND status = 'processing'`
        ).run(this.userId);

        const rows = this.db.prepare(
            `SELECT id, chat_id, question, user_name, message_id, status, created_at
             FROM message_queue WHERE user_id = ? AND status != 'done' ORDER BY created_at ASC`
        ).all(this.userId) as Array<{ id: string; chat_id: string; question: string; user_name: string; message_id: string; status: string; created_at: number }>;

        const tasks = rows.map(r => this.rowToTask(r));
        if (tasks.length > 0) {
            console.log(`[MessageQueue|${this.userId}] ${tasks.length} unfinished task(s) found for replay.`);
        }
        return tasks;
    }

    async enqueue(
        data: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>,
        worker: (task: QueuedTask) => Promise<void>
    ): Promise<QueuedTask> {
        const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const now = Date.now();
        this.db.prepare(
            `INSERT INTO message_queue (id, user_id, chat_id, question, user_name, message_id, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
        ).run(id, this.userId, data.sessionId, data.question, data.userName, data.messageId, now);
        const task: QueuedTask = { ...data, id, status: 'pending', createdAt: now };
        this.schedule(task, worker);
        return task;
    }

    schedule(task: QueuedTask, worker: (task: QueuedTask) => Promise<void>) {
        this.pqueue.add(async () => {
            this.setStatus(task.id, 'processing');
            try {
                await worker(task);
            } finally {
                // Delete done tasks — no accumulation
                this.db.prepare(`DELETE FROM message_queue WHERE id = ?`).run(task.id);
            }
        });
    }

    private setStatus(id: string, status: 'pending' | 'processing') {
        this.db.prepare(`UPDATE message_queue SET status = ? WHERE id = ?`).run(status, id);
    }

    private rowToTask(r: { id: string; chat_id: string; question: string; user_name: string; message_id: string; status: string; created_at: number }): QueuedTask {
        return {
            id: r.id,
            sessionId: r.chat_id,
            question: r.question,
            userName: r.user_name,
            messageId: r.message_id,
            status: r.status as QueuedTask['status'],
            createdAt: r.created_at,
        };
    }

    get queueSize() { return this.pqueue.size; }
    get activeCount() { return this.pqueue.pending; }
}
