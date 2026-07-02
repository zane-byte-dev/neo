#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, argv, exit } from 'node:process';
import { runRepl } from './cli/repl.js';
import type { ReplOptions } from './cli/repl.js';

function parseArgs(args: string[]): ReplOptions & { help: boolean } {
    const opts: ReplOptions & { help: boolean } = { help: false };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-h' || arg === '--help') opts.help = true;
        else if (arg === '--user') opts.userId = args[++i];
        else if (arg === '--model') opts.model = args[++i];
    }
    return opts;
}

const opts = parseArgs(argv.slice(2));
if (opts.help) {
    stdout.write('Usage: npm run repl -- [--user <id>] [--model <id>]\n');
    exit(0);
}

// Keep the terminal readable: silence app logs so they don't interleave with the
// conversation. Real errors still surface via the REPL renderer; opt back in
// with LOG_LEVEL=debug (or DEBUG_LLM=1) to see the full logs. Must run before the
// dynamic imports below load the logger (which resolves its level once at load).
if (!process.env.LOG_LEVEL && process.env.DEBUG_LLM !== '1') {
    process.env.LOG_LEVEL = 'critical';
}

const rl = createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) });

// Consume `line`/`close` events through a queue so both interactive (TTY) and
// piped input work without races between rl.question and emitted lines.
const lineQueue: string[] = [];
let ended = false;
let waiter: ((line: string | null) => void) | null = null;

rl.on('line', (line) => {
    if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(line);
    } else {
        lineQueue.push(line);
    }
});
rl.on('close', () => {
    ended = true;
    if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(null);
    }
});

function nextLine(): Promise<string | null> {
    if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift()!);
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => {
        waiter = resolve;
    });
}

function readLine(promptText: string): Promise<string | null> {
    stdout.write(promptText);
    return nextLine();
}

async function confirm(question: string): Promise<boolean> {
    stdout.write(`${question} [y/N] `);
    const answer = await nextLine();
    return /^y(es)?$/i.test((answer ?? '').trim());
}

let activeAbort: AbortController | null = null;
rl.on('SIGINT', () => {
    if (activeAbort) {
        activeAbort.abort();
    } else {
        rl.close();
    }
});

const [{ neoAgentRuntime }, { userList }, { sessionCreate }, { newRunId }] = await Promise.all([
    import('./app/agent-runtime.js'),
    import('@neo/agent/services/user-service.js'),
    import('@neo/agent/services/chat-service.js'),
    import('@neo/runtime'),
]);

const code = await runRepl(
    {
        runtime: neoAgentRuntime,
        userList,
        sessionCreate,
        newRunId,
        readLine,
        confirm,
        stdout,
        stderr,
        setActiveAbort: (controller) => {
            activeAbort = controller;
        },
        color: Boolean(stdout.isTTY),
    },
    opts,
);

rl.close();
exit(code);
