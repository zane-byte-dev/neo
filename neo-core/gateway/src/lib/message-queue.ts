import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import PQueue from 'p-queue';

export interface QueuedTask {
    id: string;
    chatId: number;
    question: string;
    userName: string;
    messageId: number;
    status: 'pending' | 'processing' | 'done';
    createdAt: number;
}

/**
 * Persistent message queue backed by a JSON file.
 * Tasks survive bot restarts — on init(), unfinished tasks are returned for replay.
 */
export class MessageQueue {
    private pqueue = new PQueue({ concurrency: 1 });
    private store = new Map<string, QueuedTask>();
    private dbPath: string;

    constructor(cacheDir: string) {
        this.dbPath = join(cacheDir, 'message_queue.json');
    }

    /**
     * Load tasks from disk.
     * Returns all interrupted tasks (pending/processing) sorted by creation time for replay.
     */
    async init(): Promise<QueuedTask[]> {
        try {
            const data = await fs.readFile(this.dbPath, 'utf8');
            const tasks: QueuedTask[] = JSON.parse(data);
            for (const task of tasks) {
                if (task.status !== 'done') {
                    // Treat previously-processing tasks as pending — the worker never finished
                    if (task.status === 'processing') task.status = 'pending';
                    this.store.set(task.id, task);
                }
            }
            const count = this.store.size;
            if (count > 0) {
                console.log(`[MessageQueue] Loaded ${count} unfinished task(s) from disk.`);
            }
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                console.error('[MessageQueue] Failed to load:', err.message);
            }
            await this.saveToDisk();
        }

        return Array.from(this.store.values()).sort((a, b) => a.createdAt - b.createdAt);
    }

    /**
     * Persist a new task and schedule it for immediate execution.
     */
    async enqueue(
        data: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>,
        worker: (task: QueuedTask) => Promise<void>
    ): Promise<QueuedTask> {
        const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const task: QueuedTask = { ...data, id, status: 'pending', createdAt: Date.now() };
        this.store.set(id, task);
        await this.saveToDisk();
        this.schedule(task, worker);
        return task;
    }

    /**
     * Schedule an already-persisted task (used for replay on startup).
     */
    schedule(task: QueuedTask, worker: (task: QueuedTask) => Promise<void>) {
        this.pqueue.add(async () => {
            await this.setStatus(task.id, 'processing');
            try {
                await worker(task);
            } finally {
                await this.setStatus(task.id, 'done');
            }
        });
    }

    private async setStatus(id: string, status: QueuedTask['status']) {
        const task = this.store.get(id);
        if (!task) return;
        if (status === 'done') {
            this.store.delete(id);
        } else {
            task.status = status;
        }
        await this.saveToDisk();
    }

    private async saveToDisk() {
        try {
            await fs.mkdir(dirname(this.dbPath), { recursive: true });
            const tasks = Array.from(this.store.values());
            await fs.writeFile(this.dbPath, JSON.stringify(tasks, null, 2), 'utf8');
        } catch (err: any) {
            console.error('[MessageQueue] Failed to save:', err.message);
        }
    }

    get queueSize() { return this.pqueue.size; }
    get activeCount() { return this.pqueue.pending; }
}
