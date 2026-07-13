import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

export interface PiRpcBridgeOptions {
    executable?: string;
    executableArgs?: string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
    extensionPaths?: string[];
    sessionDir?: string;
    extraArgs?: string[];
    startupTimeoutMs?: number;
}

export type PiRpcMessage = Record<string, unknown>;
export type PiRpcEventListener = (event: PiRpcMessage) => void;

interface PendingRequest {
    resolve: (message: PiRpcMessage) => void;
    reject: (error: Error) => void;
}

export class PiRpcBridge {
    private readonly options: PiRpcBridgeOptions;
    private child?: ChildProcessWithoutNullStreams;
    private lines?: Interface;
    private readonly pending = new Map<string, PendingRequest>();
    private readonly listeners = new Set<PiRpcEventListener>();
    private nextRequestId = 0;
    private stderr = '';
    private exitError?: Error;

    constructor(options: PiRpcBridgeOptions) {
        this.options = options;
    }

    async start(): Promise<void> {
        if (this.child) throw new Error('pi RPC bridge is already started');

        const executable = this.options.executable ?? process.env.PI_EXECUTABLE ?? 'pi';
        const args = [
            ...(this.options.executableArgs ?? []),
            '--mode', 'rpc',
            '--no-extensions',
            ...this.extensionArgs(),
            ...(this.options.sessionDir ? ['--session-dir', this.options.sessionDir] : []),
            ...(this.options.extraArgs ?? []),
        ];
        const child = spawn(executable, args, {
            cwd: this.options.cwd,
            env: { ...process.env, ...this.options.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.child = child;
        this.stderr = '';
        this.exitError = undefined;

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            this.stderr += chunk;
            if (this.stderr.length > 64 * 1024) this.stderr = this.stderr.slice(-64 * 1024);
        });
        child.once('error', (error) => this.handleExit(new Error(`failed to start pi RPC: ${error.message}`)));
        child.once('exit', (code, signal) => {
            this.handleExit(new Error(`pi RPC exited (${signal ?? code ?? 'unknown'}): ${this.stderr.trim()}`));
        });
        child.stdin.once('error', (error) => this.handleExit(new Error(`pi RPC stdin failed: ${error.message}`)));

        this.lines = createInterface({ input: child.stdout });
        this.lines.on('line', (line) => this.handleLine(line));

        const timeoutMs = this.options.startupTimeoutMs ?? 10_000;
        await this.withTimeout(this.send('get_state'), timeoutMs, 'pi RPC startup');
    }

    onEvent(listener: PiRpcEventListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async send(type: string, fields: Record<string, unknown> = {}): Promise<PiRpcMessage> {
        const child = this.requireChild();
        const id = `neo_${++this.nextRequestId}`;
        const message = { id, type, ...fields };
        return new Promise<PiRpcMessage>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
                if (!error) return;
                this.pending.delete(id);
                reject(error);
            });
        });
    }

    async prompt(message: string): Promise<void> {
        await this.send('prompt', { message });
    }

    async abort(): Promise<void> {
        await this.send('abort');
    }

    async promptAndWait(message: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<PiRpcMessage> {
        const settled = new Promise<PiRpcMessage>((resolve, reject) => {
            const remove = this.onEvent((event) => {
                if (event.type === 'agent_settled') {
                    remove();
                    options.signal?.removeEventListener('abort', onAbort);
                    resolve(event);
                }
            });
            const onAbort = () => {
                remove();
                void this.abort().finally(() => reject(new DOMException('Aborted', 'AbortError')));
            };
            if (options.signal?.aborted) onAbort();
            else options.signal?.addEventListener('abort', onAbort, { once: true });
        });
        await this.prompt(message);
        return this.withTimeout(settled, options.timeoutMs ?? 10 * 60_000, 'pi RPC prompt');
    }

    async stop(): Promise<void> {
        const child = this.child;
        if (!child) return;
        this.child = undefined;
        this.lines?.close();
        this.lines = undefined;
        child.stdin.end();
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
            if (child.exitCode !== null) return resolve();
            const force = setTimeout(() => {
                child.kill('SIGKILL');
                resolve();
            }, 2_000);
            child.once('exit', () => {
                clearTimeout(force);
                resolve();
            });
        });
        this.rejectPending(new Error('pi RPC bridge stopped'));
    }

    getStderr(): string {
        return this.stderr;
    }

    private extensionArgs(): string[] {
        return (this.options.extensionPaths ?? []).flatMap((path) => ['--extension', path]);
    }

    private requireChild(): ChildProcessWithoutNullStreams {
        if (!this.child) throw this.exitError ?? new Error('pi RPC bridge is not started');
        return this.child;
    }

    private handleLine(line: string): void {
        let message: PiRpcMessage;
        try {
            message = JSON.parse(line) as PiRpcMessage;
        } catch {
            this.handleExit(new Error(`pi RPC emitted invalid JSONL: ${line.slice(0, 500)}`));
            return;
        }
        if (message.type === 'response' && typeof message.id === 'string') {
            const request = this.pending.get(message.id);
            if (!request) return;
            this.pending.delete(message.id);
            if (message.success === false) {
                request.reject(new Error(typeof message.error === 'string' ? message.error : `pi RPC command ${String(message.command)} failed`));
            } else {
                request.resolve(message);
            }
            return;
        }
        for (const listener of this.listeners) listener(message);
    }

    private handleExit(error: Error): void {
        if (!this.child && this.exitError) return;
        this.exitError = error;
        this.child = undefined;
        this.rejectPending(error);
    }

    private rejectPending(error: Error): void {
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
        let timeout: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
                }),
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }
}
