import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { PiRpcBridge, type PiRpcBridgeOptions } from './pi-rpc-bridge.js';

interface SessionMapping {
    schemaVersion: 1;
    neoSessionId: string;
    piSessionId: string;
    piSessionFile: string;
    updatedAt: string;
}

export interface PiBridgeRunInput {
    stateDir: string;
    workspaceRoot: string;
    neoSessionId: string;
    message: string;
    model?: { provider: string; id: string };
    signal?: AbortSignal;
    onEvent: Parameters<PiRpcBridge['onEvent']>[0];
}

export interface PiBridgeManagerOptions {
    executable?: string;
    atmExecutable?: string;
    atmExtensionPath: string;
    atxExtensionPath?: string;
    providerExtensionPath?: string;
    skillPaths?: string[];
    defaultModel?: { provider: string; id: string };
    bridgeFactory?: (options: PiRpcBridgeOptions) => PiRpcBridge;
}

export class PiBridgeManager {
    private readonly options: PiBridgeManagerOptions;
    private readonly active = new Map<string, PiRpcBridge>();
    private readonly running = new Set<string>();

    constructor(options: PiBridgeManagerOptions) {
        this.options = options;
    }

    async run(input: PiBridgeRunInput): Promise<void> {
        const key = `${input.stateDir}\0${input.neoSessionId}`;
        if (this.running.has(key)) throw new Error(`pi session is already running: ${input.neoSessionId}`);
        this.running.add(key);
        try {
            const bridge = await this.getOrStartBridge(input, key);
            const remove = bridge.onEvent(input.onEvent);
            try {
                const model = input.model ?? this.options.defaultModel;
                if (model) {
                    await bridge.send('set_model', { provider: model.provider, modelId: model.id });
                }
                await bridge.promptAndWait(input.message, { signal: input.signal });
                await this.persistMapping(input.stateDir, input.neoSessionId, bridge);
            } finally {
                remove();
            }
        } finally {
            this.running.delete(key);
        }
    }

    async abort(stateDir: string, neoSessionId: string): Promise<boolean> {
        const bridge = this.active.get(`${stateDir}\0${neoSessionId}`);
        if (!bridge) return false;
        await bridge.abort();
        return true;
    }

    async shutdown(): Promise<void> {
        const bridges = [...this.active.values()];
        this.active.clear();
        await Promise.allSettled(bridges.map((bridge) => bridge.stop()));
    }

    private async getOrStartBridge(input: PiBridgeRunInput, key: string): Promise<PiRpcBridge> {
        const existing = this.active.get(key);
        if (existing) return existing;
        const mapping = await this.readMapping(input.stateDir, input.neoSessionId);
        const sessionDir = join(input.stateDir, 'pi-sessions', 'transcripts');
        await fs.mkdir(sessionDir, { recursive: true });
        const extensionPaths = [
            this.options.atmExtensionPath,
            ...(this.options.atxExtensionPath ? [this.options.atxExtensionPath] : []),
            ...(this.options.providerExtensionPath ? [this.options.providerExtensionPath] : []),
        ];
        const bridgeOptions: PiRpcBridgeOptions = {
            executable: this.options.executable,
            cwd: input.workspaceRoot,
            sessionDir,
            extensionPaths,
            env: {
                ATM_EXECUTABLE: this.options.atmExecutable,
                ATM_WORKSPACE_ROOT: input.workspaceRoot,
            },
            extraArgs: [
                '--no-approve',
                '--no-skills',
                ...(this.options.skillPaths ?? []).flatMap((path) => ['--skill', path]),
                ...(mapping?.piSessionFile ? ['--session', mapping.piSessionFile] : []),
            ],
        };
        const bridge = (this.options.bridgeFactory ?? ((options) => new PiRpcBridge(options)))(bridgeOptions);
        try {
            await bridge.start();
        } catch (error) {
            await bridge.stop();
            throw error;
        }
        this.active.set(key, bridge);
        await this.persistMapping(input.stateDir, input.neoSessionId, bridge);
        return bridge;
    }

    private async persistMapping(stateDir: string, neoSessionId: string, bridge: PiRpcBridge): Promise<void> {
        const response = await bridge.send('get_state');
        const data = response.data as { sessionId?: unknown; sessionFile?: unknown } | undefined;
        if (typeof data?.sessionId !== 'string' || typeof data.sessionFile !== 'string') {
            throw new Error('pi get_state did not return a persistent session id and file');
        }
        const mapping: SessionMapping = {
            schemaVersion: 1,
            neoSessionId,
            piSessionId: data.sessionId,
            piSessionFile: data.sessionFile,
            updatedAt: new Date().toISOString(),
        };
        const path = this.mappingPath(stateDir, neoSessionId);
        await fs.mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temporary, `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
        await fs.rename(temporary, path);
    }

    private async readMapping(stateDir: string, neoSessionId: string): Promise<SessionMapping | undefined> {
        try {
            const data = JSON.parse(await fs.readFile(this.mappingPath(stateDir, neoSessionId), 'utf8')) as SessionMapping;
            if (data.schemaVersion !== 1 || data.neoSessionId !== neoSessionId) throw new Error('invalid pi session mapping');
            return data;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
        }
    }

    private mappingPath(stateDir: string, neoSessionId: string): string {
        const safeId = neoSessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
        return join(stateDir, 'pi-sessions', 'mappings', `${safeId}.json`);
    }
}
