import type Database from 'better-sqlite3';
import type { TenantKey } from '../types/platform.js';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AsyncTask {
    id: string;
    chatId: string;
    prompt: string;
    status: TaskStatus;
    result?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
}

export class AsyncTaskManager {
    private db: Database.Database;
    private tenantKey: TenantKey;
    private pollingInterval: NodeJS.Timeout | null = null;
    private isPolling = false;

    constructor(db: Database.Database, tenantKey: TenantKey) {
        this.db = db;
        this.tenantKey = tenantKey;
    }

    async init(): Promise<void> {
        const count = (this.db.prepare(
            `SELECT COUNT(*) as n FROM async_tasks WHERE tenant_key = ?`
        ).get(this.tenantKey) as { n: number }).n;
        console.log(`[AsyncTaskManager|${this.tenantKey}] Ready (${count} existing tasks).`);
    }

    async createTask(chatId: string, prompt: string): Promise<AsyncTask> {
        const id = this.generateId();
        const now = Date.now();
        this.db.prepare(
            `INSERT INTO async_tasks (id, tenant_key, chat_id, prompt, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?, ?)`
        ).run(id, this.tenantKey, chatId, prompt, now, now);
        console.log(`[AsyncTaskManager|${this.tenantKey}] Created task: ${id}`);
        return this.getTask(id)!;
    }

    async updateTaskStatus(id: string, status: TaskStatus, resultOrError?: { result?: string; error?: string }): Promise<AsyncTask | null> {
        const task = this.getTask(id);
        if (!task) {
            console.error(`[AsyncTaskManager Error] Task ${id} not found.`);
            return null;
        }
        const now = Date.now();
        this.db.prepare(
            `UPDATE async_tasks SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?`
        ).run(
            status,
            resultOrError?.result ?? task.result ?? null,
            resultOrError?.error ?? task.error ?? null,
            now,
            id
        );
        console.log(`[AsyncTaskManager] Task ${id} updated to ${status}`);
        return this.getTask(id)!;
    }

    getTask(id: string): AsyncTask | undefined {
        const row = this.db.prepare(
            `SELECT id, chat_id, prompt, status, result, error, created_at, updated_at
             FROM async_tasks WHERE id = ?`
        ).get(id) as { id: string; chat_id: string; prompt: string; status: string; result: string | null; error: string | null; created_at: number; updated_at: number } | undefined;
        if (!row) return undefined;
        return this.rowToTask(row);
    }

    getTasksByStatus(status: TaskStatus): AsyncTask[] {
        const rows = this.db.prepare(
            `SELECT id, chat_id, prompt, status, result, error, created_at, updated_at
             FROM async_tasks WHERE tenant_key = ? AND status = ?`
        ).all(this.tenantKey, status) as Array<{ id: string; chat_id: string; prompt: string; status: string; result: string | null; error: string | null; created_at: number; updated_at: number }>;
        return rows.map(r => this.rowToTask(r));
    }

    getAllTasks(): AsyncTask[] {
        const rows = this.db.prepare(
            `SELECT id, chat_id, prompt, status, result, error, created_at, updated_at
             FROM async_tasks WHERE tenant_key = ? ORDER BY created_at DESC`
        ).all(this.tenantKey) as Array<{ id: string; chat_id: string; prompt: string; status: string; result: string | null; error: string | null; created_at: number; updated_at: number }>;
        return rows.map(r => this.rowToTask(r));
    }

    async cancelTask(id: string): Promise<boolean> {
        const task = this.getTask(id);
        if (!task) return false;
        if (task.status === 'completed' || task.status === 'failed') return false;
        await this.updateTaskStatus(id, 'failed', { error: '用户手动取消' });
        return true;
    }

    startPolling(onComplete: (task: AsyncTask, result: string) => void) {
        if (this.pollingInterval) return;
        console.log('[AsyncTaskManager] Starting stale-task watchdog...');
        this.pollingInterval = setInterval(() => {
            this.pollRunningTasks(onComplete);
        }, 60 * 1000);
    }

    private async pollRunningTasks(_onComplete: (task: AsyncTask, result: string) => void) {
        if (this.isPolling) return;
        this.isPolling = true;
        try {
            const STALE_MS = 30 * 60 * 1000;
            const now = Date.now();
            for (const task of this.getTasksByStatus('running')) {
                if (now - task.updatedAt > STALE_MS) {
                    console.log(`[AsyncTaskManager] Task #${task.id} is stale (>30 min), marking failed.`);
                    await this.updateTaskStatus(task.id, 'failed', { error: '任务超时（超过30分钟无响应）' });
                }
            }
        } finally {
            this.isPolling = false;
        }
    }

    private rowToTask(row: { id: string; chat_id: string; prompt: string; status: string; result: string | null; error: string | null; created_at: number; updated_at: number }): AsyncTask {
        return {
            id: row.id,
            chatId: row.chat_id,
            prompt: row.prompt,
            status: row.status as TaskStatus,
            result: row.result ?? undefined,
            error: row.error ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private generateId(): string {
        return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }
}
