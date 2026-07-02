import type { Writable } from 'node:stream';
import type { AgentRuntime, RunEvent } from '@neo/runtime';

export interface ReplUser {
    id: string;
    name: string;
}

export interface ReplSession {
    id: string;
}

export interface ReplDeps {
    runtime: AgentRuntime;
    userList(): ReplUser[];
    sessionCreate(userId: string, id?: string, opts?: { title?: string }): Promise<ReplSession>;
    newRunId(): string;
    /** Read one line of user input. Resolves `null` on EOF (Ctrl+D / closed stream). */
    readLine(promptText: string): Promise<string | null>;
    /** Interactive yes/no confirmation for dangerous tool calls. */
    confirm(question: string): Promise<boolean>;
    stdout: Pick<Writable, 'write'>;
    stderr: Pick<Writable, 'write'>;
    /**
     * Optional hook so the entrypoint can cancel the active run on Ctrl+C.
     * Called with a controller when a turn starts and `null` when it ends.
     */
    setActiveAbort?(controller: AbortController | null): void;
    /** Enable ANSI colors. Defaults to false. */
    color?: boolean;
}

export interface ReplOptions {
    userId?: string;
    model?: string;
}

const HELP = [
    'Commands:',
    '  /help, /?         Show this help',
    '  /new              Start a fresh chat session',
    '  /model [id]       Show or set the model for new turns',
    '  /session          Show the current session id',
    '  /clear            Clear the screen',
    '  /exit, /quit      Leave the REPL',
    '',
    'Tips: Ctrl+C cancels the running turn (or exits when idle), Ctrl+D exits.',
].join('\n');

function paint(deps: ReplDeps, code: string, text: string): string {
    return deps.color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export async function runRepl(deps: ReplDeps, options: ReplOptions = {}): Promise<number> {
    const users = deps.userList();
    const userId = options.userId ?? users[0]?.id;
    if (!userId) {
        deps.stderr.write('No configured user found. Start Neo once to bootstrap ~/.neo/config.json, or configure USERS.\n');
        return 2;
    }

    let currentModel = options.model;
    let session = await deps.sessionCreate(userId, undefined, { title: 'REPL' });

    deps.stdout.write(`${paint(deps, '1;36', 'Neo')} interactive session — type /help for commands.\n`);
    deps.stdout.write(`user=${userId} session=${session.id}${currentModel ? ` model=${currentModel}` : ''}\n\n`);

    const promptText = paint(deps, '1;32', '› ');

    for (;;) {
        const line = await deps.readLine(promptText);
        if (line === null) break; // EOF
        const message = line.trim();
        if (!message) continue;

        if (message.startsWith('/')) {
            const [cmd, ...rest] = message.slice(1).split(/\s+/);
            const arg = rest.join(' ').trim();
            if (cmd === 'exit' || cmd === 'quit') break;
            if (cmd === 'help' || cmd === '?') {
                deps.stdout.write(`${HELP}\n\n`);
                continue;
            }
            if (cmd === 'clear') {
                deps.stdout.write('\x1b[2J\x1b[H');
                continue;
            }
            if (cmd === 'session') {
                deps.stdout.write(`session=${session.id}\n\n`);
                continue;
            }
            if (cmd === 'new') {
                session = await deps.sessionCreate(userId, undefined, { title: 'REPL' });
                deps.stdout.write(`Started new session ${session.id}\n\n`);
                continue;
            }
            if (cmd === 'model') {
                if (arg) {
                    currentModel = arg;
                    deps.stdout.write(`Model set to ${currentModel}\n\n`);
                } else {
                    deps.stdout.write(`model=${currentModel ?? '(default routing)'}\n\n`);
                }
                continue;
            }
            deps.stderr.write(`Unknown command: /${cmd}. Type /help.\n\n`);
            continue;
        }

        await runTurn(deps, { userId, sessionId: session.id, message, model: currentModel });
        deps.stdout.write('\n');
    }

    deps.stdout.write('\nBye.\n');
    return 0;
}

interface TurnInput {
    userId: string;
    sessionId: string;
    message: string;
    model?: string;
}

async function runTurn(deps: ReplDeps, input: TurnInput): Promise<void> {
    const runId = deps.newRunId();
    const controller = new AbortController();
    deps.setActiveAbort?.(controller);

    const streamPromise = streamEvents(deps, input.userId, runId);
    try {
        await deps.runtime.startRun({
            userId: input.userId,
            sessionId: input.sessionId,
            runId,
            entrypoint: 'cli',
            triggerType: 'user_message',
            message: input.message,
            signal: controller.signal,
            ...(input.model !== undefined && { model: input.model }),
            confirmCallback: async ({ toolName }) => {
                return deps.confirm(`Allow tool "${toolName}"?`);
            },
        });
        await streamPromise;
    } catch (err) {
        await streamPromise.catch(() => undefined);
        if (controller.signal.aborted) {
            deps.stderr.write(`\n${paint(deps, '33', '[cancelled]')}\n`);
        } else {
            deps.stderr.write(`\n${paint(deps, '31', '[error]')} ${err instanceof Error ? err.message : String(err)}\n`);
        }
    } finally {
        deps.setActiveAbort?.(null);
    }
}

async function streamEvents(deps: ReplDeps, userId: string, runId: string): Promise<void> {
    let cursor = -1;
    let terminal = false;
    let misses = 0;
    while (!terminal) {
        try {
            const { events, nextCursor } = await deps.runtime.events(userId, runId, {
                afterIndex: cursor,
                limit: 100,
            });
            cursor = nextCursor;
            misses = 0;
            for (const event of events) {
                terminal = renderEvent(deps, event);
                if (terminal) return;
            }
        } catch (err) {
            const code = typeof err === 'object' && err !== null && 'code' in err
                ? String((err as { code?: unknown }).code)
                : '';
            if (code !== 'not_found' || misses > 50) throw err;
            misses += 1;
        }
        await delay(50);
    }
}

function renderEvent(deps: ReplDeps, event: RunEvent): boolean {
    switch (event.type) {
        case 'llm_chunk':
            if (event.payload.chunkType === 'text' && event.payload.text) {
                deps.stdout.write(event.payload.text);
            }
            break;
        case 'tool_call_started':
            deps.stderr.write(`\n${paint(deps, '2', `[tool] ${event.payload.toolName}`)}\n`);
            break;
        case 'tool_call_finished':
            if (event.payload.outcome !== 'success') {
                deps.stderr.write(`${paint(deps, '2', `[tool ${event.payload.outcome}] ${event.payload.toolName}`)}\n`);
            }
            break;
        case 'run_failed':
            deps.stderr.write(`\n${paint(deps, '31', '[failed]')} ${event.payload.error.message}\n`);
            return true;
        case 'run_completed':
            return true;
    }
    return false;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
