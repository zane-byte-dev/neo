import { promises as fs } from 'fs';
import { join } from 'path';
import { execa } from 'execa';

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

    constructor(private workDir: string) {
        // Store tasks in the same directory as chat history for now
        this.dbPath = join(workDir, 'history', 'async_tasks.json');
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
     * Start a background polling interval to check on running tasks
     * by spawning a quick specialized gemini CLI process.
     */
    startPolling(onComplete: (task: AsyncTask, result: string) => void) {
        if (this.pollingInterval) return;

        console.log('[AsyncTaskManager] Starting polling loop for long-running tasks...');
        
        // Poll every 1 minute
        this.pollingInterval = setInterval(() => {
            this.pollRunningTasks(onComplete);
        }, 60 * 1000);
    }

    private async pollRunningTasks(onComplete: (task: AsyncTask, result: string) => void) {
        if (this.isPolling) return;
        this.isPolling = true;

        try {
            const runningTasks = this.getTasksByStatus('running');
            if (runningTasks.length === 0) return;

            console.log(`[AsyncTaskManager] Polling ${runningTasks.length} running tasks...`);

            for (const task of runningTasks) {
                // Determine if this is a research task (could add task type metadata in the future)
                if (task.prompt.toLowerCase().includes('调研') || task.prompt.toLowerCase().includes('research')) {
                    await this.checkDeepResearchStatus(task, onComplete);
                }
            }
        } finally {
            this.isPolling = false;
        }
    }

    private async checkDeepResearchStatus(task: AsyncTask, onComplete: (task: AsyncTask, result: string) => void) {
        // We spawn a short-lived gemini CLI process just to ask the status of the research.
        // DeepResearch creates tracking files in the local filesystem, or the tool returns status.
        try {
            console.log(`[AsyncTaskManager] Checking status for task #${task.id}...`);
            
            const prompt = `Please check if there is any completed "Deep Research" report related to this task prompt: "${task.prompt}". If it's completed, summarize the findings. If it's still running, just reply with exactly "STILL_RUNNING". Use the research_status tool if necessary.`;
            
            const result = await execa(process.env.GEMINI_CLI_PATH || 'gemini', ['--model', 'gemini-2.5-flash-preview', prompt], {
                cwd: this.workDir,
                timeout: 30000 // 30s timeout so we don't hang the poller
            });

            const output = result.stdout.trim();
            
            if (output && !output.includes('STILL_RUNNING') && !output.toLowerCase().includes('not completed') && !output.toLowerCase().includes('no report found')) {
                // It seems completed
                console.log(`[AsyncTaskManager] Task #${task.id} appears completed.`);
                await this.updateTaskStatus(task.id, 'completed', { result: output });
                
                // Trigger callback to notify the user via Telegram
                onComplete(task, output);
            } else {
                console.log(`[AsyncTaskManager] Task #${task.id} is still running.`);
            }

        } catch (err: any) {
            console.log(`[AsyncTaskManager] Error checking status for task #${task.id}:`, err.message);
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
