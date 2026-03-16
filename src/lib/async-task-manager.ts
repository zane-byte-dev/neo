import { promises as fs } from 'fs';
import { join } from 'path';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AsyncTask {
    id: string;
    chatId: number;
    prompt: string;
    status: TaskStatus;
    result?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
}

export class AsyncTaskManager {
    private dbPath: string;
    private memoryCache: Map<string, AsyncTask> = new Map();
    private pollingInterval: NodeJS.Timeout | null = null;
    private isPolling = false;

    constructor(cacheDir: string) {
        this.dbPath = join(cacheDir, 'async_tasks.json');
    }

    /**
     * Initialize the task manager and load existing tasks
     */
    async init() {
        try {
            const data = await fs.readFile(this.dbPath, 'utf8');
            const tasks: AsyncTask[] = JSON.parse(data);
            for (const task of tasks) {
                this.memoryCache.set(task.id, task);
            }
            console.log(`[AsyncTaskManager] Loaded ${tasks.length} tasks from disk.`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, create an empty one
                await this.saveToDisk();
                console.log('[AsyncTaskManager] Created new async_tasks.json file.');
            } else {
                console.error('[AsyncTaskManager Error] Failed to load tasks:', error);
            }
        }
    }

    /**
     * Create a new asynchronous task
     */
    async createTask(chatId: number, prompt: string): Promise<AsyncTask> {
        const id = this.generateId();
        const now = Date.now();
        
        const task: AsyncTask = {
            id,
            chatId,
            prompt,
            status: 'pending',
            createdAt: now,
            updatedAt: now
        };

        this.memoryCache.set(id, task);
        await this.saveToDisk();
        
        console.log(`[AsyncTaskManager] Created new task: ${id}`);
        return task;
    }

    /**
     * Update the status of an existing task
     */
    async updateTaskStatus(id: string, status: TaskStatus, resultOrError?: { result?: string; error?: string }): Promise<AsyncTask | null> {
        const task = this.memoryCache.get(id);
        if (!task) {
            console.error(`[AsyncTaskManager Error] Task ${id} not found.`);
            return null;
        }

        task.status = status;
        task.updatedAt = Date.now();
        
        if (resultOrError) {
            if (resultOrError.result !== undefined) task.result = resultOrError.result;
            if (resultOrError.error !== undefined) task.error = resultOrError.error;
        }

        this.memoryCache.set(id, task);
        await this.saveToDisk();
        
        console.log(`[AsyncTaskManager] Task ${id} updated to ${status}`);
        return task;
    }

    /**
     * Get a specific task by ID
     */
    getTask(id: string): AsyncTask | undefined {
        return this.memoryCache.get(id);
    }

    /**
     * Get all tasks with a specific status
     */
    getTasksByStatus(status: TaskStatus): AsyncTask[] {
        return Array.from(this.memoryCache.values()).filter(t => t.status === status);
    }

    /**
     * Get all tasks, sorted by createdAt descending
     */
    getAllTasks(): AsyncTask[] {
        return Array.from(this.memoryCache.values())
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Cancel a pending or running task by ID
     */
    async cancelTask(id: string): Promise<boolean> {
        const task = this.memoryCache.get(id);
        if (!task) return false;
        if (task.status === 'completed' || task.status === 'failed') return false;
        await this.updateTaskStatus(id, 'failed', { error: '用户手动取消' });
        return true;
    }

    /**
     * Start a background polling interval.
     * Tasks are completed directly by processAsyncTaskBackground, so this loop
     * only serves as a safety net: any task stuck in 'running' for more than
     * 30 minutes is automatically marked failed.
     */
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
            const runningTasks = this.getTasksByStatus('running');
            if (runningTasks.length === 0) return;

            const STALE_MS = 30 * 60 * 1000; // 30 minutes
            const now = Date.now();

            for (const task of runningTasks) {
                if (now - task.updatedAt > STALE_MS) {
                    console.log(`[AsyncTaskManager] Task #${task.id} is stale (>30 min), marking failed.`);
                    await this.updateTaskStatus(task.id, 'failed', { error: '任务超时（超过30分钟无响应）' });
                }
            }
        } finally {
            this.isPolling = false;
        }
    }

    /**
     * Save current memory cache to disk
     */
    private async saveToDisk() {
        try {
            const tasks = Array.from(this.memoryCache.values());
            await fs.writeFile(this.dbPath, JSON.stringify(tasks, null, 2), 'utf8');
        } catch (error) {
            console.error('[AsyncTaskManager Error] Failed to save tasks to disk:', error);
        }
    }

    /**
     * Generate a simple unique ID
     */
    private generateId(): string {
        return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }
}
