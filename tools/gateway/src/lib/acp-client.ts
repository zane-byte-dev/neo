import { execa, execaCommand, ResultPromise } from 'execa';
import { EventEmitter } from 'events';
import * as readline from 'readline';

export interface JSONRPCRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: any;
}

export interface JSONRPCResponse {
    jsonrpc: '2.0';
    id: number;
    result?: any;
    error?: any;
}

export interface JSONRPCNotification {
    jsonrpc: '2.0';
    method: string;
    params?: any;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

export class AcpClient extends EventEmitter {
    private process: any;
    private rl?: readline.Interface;
    private messageIdCounter = 1;
    private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private isReady = false;

    constructor(private cwd: string, private model: string = 'gemini-2.5-flash') {
        super();
    }

    async start() {
        if (this.process) return;

        const geminiCommand = process.env.GEMINI_CLI_PATH || 'gemini';
        console.log(`[ACP Client] Spawning ${geminiCommand} --experimental-acp --model ${this.model}`);

        this.process = execa(geminiCommand, ['--experimental-acp', '--model', this.model], {
            cwd: this.cwd,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            reject: false,
        });

        if (!this.process.stdout || !this.process.stdin) {
            throw new Error('Failed to attach to stdin/stdout of gemini process.');
        }

        this.rl = readline.createInterface({
            input: this.process.stdout,
            terminal: false,
        });

        this.rl.on('line', (line) => this.handleLine(line));

        this.process.stderr?.on('data', (data: Buffer) => {
            const errLog = data.toString().trim();
            if (errLog) console.log(`[ACP STDERR] ${errLog}`);
        });

        this.process.on('exit', (code: number) => {
            console.log(`[ACP Client] Process exited with code ${code}`);
            this.isReady = false;
            this.process = undefined;
            this.emit('exit', code);
        });

        await this.handshake();
    }

    private handleLine(line: string) {
        if (!line.trim()) return;

        try {
            const msg = JSON.parse(line) as JSONRPCMessage;

            // Is it a response to a request we sent?
            if ('id' in msg && ('result' in msg || 'error' in msg)) {
                const pending = this.pendingRequests.get(msg.id as number);
                if (pending) {
                    this.pendingRequests.delete(msg.id as number);
                    if (msg.error) {
                        pending.reject(msg.error);
                    } else {
                        pending.resolve(msg.result);
                    }
                }
            } else if ('method' in msg) {
                // It's a notification from the server
                this.emit('notification', msg as JSONRPCNotification);
            }
        } catch (err) {
            console.log(`[ACP RAW] ${line}`); // Unparsable lines might just be logs
        }
    }

    private async sendRequest(method: string, params: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = this.messageIdCounter++;
            const req: JSONRPCRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            this.pendingRequests.set(id, { resolve, reject });

            const payload = JSON.stringify(req) + '\n';
            this.process.stdin.write(payload, (err: any) => {
                if (err) {
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });
        });
    }

    private activeSessionId: string | null = null;

    private async handshake() {
        console.log('[ACP Client] 🤝 Sending initialize request...');
        await this.sendRequest('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
        });

        console.log('[ACP Client] 📁 Attempting session/new...');
        let sessionId;
        try {
            // First try to create a session. If no authed session, the CLI might reject or demand auth.
            const sessionRes = await this.sendRequest('session/new', {
                cwd: this.cwd,
                mcpServers: []
            });
            sessionId = sessionRes.sessionId;
            console.log(`[ACP Client] ✅ Session created: ${sessionId}`);
        } catch (e: any) {
            if (e?.message?.includes('Authentication required') || (typeof e === 'string' && e.includes('Authentication required'))) {
                console.log('[ACP Client] 🔐 Authentication required, sending authenticate payload...');
                await this.sendRequest('authenticate', { methodId: 'oauth-personal' });
                const retrySessionRes = await this.sendRequest('session/new', { cwd: this.cwd, mcpServers: [] });
                sessionId = retrySessionRes.sessionId;
                console.log(`[ACP Client] ✅ Session created after auth: ${sessionId}`);
            } else {
                throw e; // Unhandled handshake error
            }
        }

        this.activeSessionId = sessionId;
        this.isReady = true;
        console.log('[ACP Client] 🚀 Handshake complete, ACP ready.');
    }

    async prompt(text: string): Promise<string> {
        if (!this.isReady || !this.activeSessionId) throw new Error('ACP Client is not fully initialized.');

        return new Promise((resolve, reject) => {
            let fullResponse = '';

            const timeoutSeconds = parseInt(process.env.GEMINI_TIMEOUT || '180', 10);
            const timeoutHandler = setTimeout(() => {
                this.off('notification', handleNotification);
                reject(new Error(`🔥 [ACP Timeout] The request exceeded ${timeoutSeconds} seconds.`));
            }, timeoutSeconds * 1000);

            const handleNotification = (msg: JSONRPCNotification) => {
                if (msg.method === 'session/update') {
                    const updateData = msg.params?.update;
                    if (updateData?.sessionUpdate === 'agent_message_chunk') {
                        if (updateData.content?.text) {
                            fullResponse += updateData.content.text;
                        }
                    } else if (updateData?.sessionUpdate === 'agent_thought_chunk') {
                        // ignore thoughts for now, or log them
                    }
                }
            };

            this.on('notification', handleNotification);

            // Send standard ACP prompt
            this.sendRequest('session/prompt', {
                sessionId: this.activeSessionId,
                prompt: [{ type: 'text', text }]
            }).then(() => {
                clearTimeout(timeoutHandler);
                this.off('notification', handleNotification);
                resolve(fullResponse);
            }).catch(err => {
                clearTimeout(timeoutHandler);
                this.off('notification', handleNotification);
                reject(err);
            });
        });
    }

    /**
     * Terminate the ACP CLI process.
     */
    close() {
        if (this.process) {
            this.process.kill();
            console.log('[ACP Client] Process stopped.');
        }
    }

    stop() {
        if (this.process) {
            this.process.kill();
        }
    }
}
