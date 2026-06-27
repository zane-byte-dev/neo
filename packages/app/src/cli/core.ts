import type { Writable } from 'node:stream';
import type { AgentRuntime, RunEvent } from '@neo/runtime';

export interface CliUser {
    id: string;
    name: string;
}

export interface CliSession {
    id: string;
}

export interface CliDeps {
    runtime: AgentRuntime;
    userList(): CliUser[];
    sessionGetCurrent(userId: string): Promise<CliSession | null>;
    sessionCreate(userId: string, id?: string, opts?: { title?: string }): Promise<CliSession>;
    newRunId(): string;
    readStdin(): Promise<string>;
    stdout: Pick<Writable, 'write'>;
    stderr: Pick<Writable, 'write'>;
}

export interface CliOptions {
    help: boolean;
    userId?: string;
    sessionId?: string;
    model?: string;
    newSession: boolean;
    yes: boolean;
    no: boolean;
    json: boolean;
    message: string;
}

export function usage(): string {
    return [
        'Usage: npm run cli -- [options] <message>',
        '',
        'Options:',
        '  --user <id>       User id (defaults to the first configured user)',
        '  --session <id>    Existing session id',
        '  --new-session     Force a new chat session',
        '  --model <id>      Model alias/id for this run',
        '  --yes             Auto-approve dangerous tool confirmations',
        '  --no              Auto-deny dangerous tool confirmations',
        '  --json            Print runtime events as JSON lines',
        '  -h, --help        Show this help',
    ].join('\n');
}

export function parseCliArgs(argv: string[]): CliOptions {
    const opts: CliOptions = {
        help: false,
        newSession: false,
        yes: false,
        no: false,
        json: false,
        message: '',
    };
    const messageParts: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '-h':
            case '--help':
                opts.help = true;
                break;
            case '--user':
                opts.userId = readOptionValue(argv, ++i, arg);
                break;
            case '--session':
                opts.sessionId = readOptionValue(argv, ++i, arg);
                break;
            case '--model':
                opts.model = readOptionValue(argv, ++i, arg);
                break;
            case '--new-session':
                opts.newSession = true;
                break;
            case '--yes':
                opts.yes = true;
                break;
            case '--no':
                opts.no = true;
                break;
            case '--json':
                opts.json = true;
                break;
            default:
                if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
                messageParts.push(arg);
                break;
        }
    }

    if (opts.yes && opts.no) throw new Error('--yes and --no cannot be used together');
    opts.message = messageParts.join(' ').trim();
    return opts;
}

function readOptionValue(argv: string[], index: number, option: string): string {
    const value = argv[index];
    if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`);
    return value;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
    let opts: CliOptions;
    try {
        opts = parseCliArgs(argv);
    } catch (err) {
        deps.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${usage()}\n`);
        return 2;
    }

    if (opts.help) {
        deps.stdout.write(`${usage()}\n`);
        return 0;
    }

    const message = opts.message || (await deps.readStdin()).trim();
    if (!message) {
        deps.stderr.write(`Message required.\n\n${usage()}\n`);
        return 2;
    }

    const users = deps.userList();
    const userId = opts.userId ?? users[0]?.id;
    if (!userId) {
        deps.stderr.write('No configured user found. Start Neo once to bootstrap ~/.neo/config.json, or configure USERS.\n');
        return 2;
    }

    let session: CliSession | null = null;
    if (!opts.newSession && opts.sessionId) {
        session = { id: opts.sessionId };
    } else if (!opts.newSession) {
        session = await deps.sessionGetCurrent(userId);
    }
    if (!session) {
        session = await deps.sessionCreate(userId, opts.sessionId, { title: 'CLI' });
    }

    const runId = deps.newRunId();
    const streamPromise = streamEvents({
        runtime: deps.runtime,
        userId,
        runId,
        json: opts.json,
        stdout: deps.stdout,
        stderr: deps.stderr,
    });

    try {
        await deps.runtime.startRun({
            userId,
            sessionId: session.id,
            runId,
            entrypoint: 'cli',
            triggerType: 'user_message',
            message,
            ...(opts.model !== undefined && { model: opts.model }),
            confirmCallback: async ({ toolName }) => {
                if (opts.yes) return true;
                if (opts.no) return false;
                deps.stderr.write(`\n[confirm] ${toolName}: denied. Re-run with --yes to auto-approve dangerous tools.\n`);
                return false;
            },
        });
        await streamPromise;
        if (!opts.json) deps.stdout.write('\n');
        return 0;
    } catch (err) {
        await streamPromise.catch(() => undefined);
        deps.stderr.write(`\n[error] ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
    }
}

interface StreamEventsInput {
    runtime: AgentRuntime;
    userId: string;
    runId: string;
    json: boolean;
    stdout: Pick<Writable, 'write'>;
    stderr: Pick<Writable, 'write'>;
}

async function streamEvents(input: StreamEventsInput): Promise<void> {
    let cursor = -1;
    let terminal = false;
    let misses = 0;
    while (!terminal) {
        try {
            const { events, nextCursor } = await input.runtime.events(input.userId, input.runId, {
                afterIndex: cursor,
                limit: 100,
            });
            cursor = nextCursor;
            misses = 0;
            for (const event of events) {
                terminal = renderEvent(event, input);
            }
            if (terminal) return;
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

function renderEvent(event: RunEvent, input: StreamEventsInput): boolean {
    if (input.json) {
        input.stdout.write(`${JSON.stringify(event)}\n`);
        return event.type === 'run_completed' || event.type === 'run_failed';
    }

    switch (event.type) {
        case 'llm_chunk':
            if (event.payload.chunkType === 'text' && event.payload.text) {
                input.stdout.write(event.payload.text);
            }
            break;
        case 'tool_call_started':
            input.stderr.write(`\n[tool] ${event.payload.toolName}\n`);
            break;
        case 'confirm_requested':
            input.stderr.write(`\n[confirm requested] ${event.payload.toolName ?? event.payload.actionId}\n`);
            break;
        case 'run_failed':
            input.stderr.write(`\n[failed] ${event.payload.error.message}\n`);
            return true;
        case 'run_completed':
            return true;
    }
    return false;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
