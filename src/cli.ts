#!/usr/bin/env node

import { stdin, stdout, stderr, argv, exit } from 'node:process';
import { parseCliArgs, runCli, usage } from './cli/core.js';

async function readStdin(): Promise<string> {
    if (stdin.isTTY) return '';
    stdin.setEncoding('utf8');
    let text = '';
    for await (const chunk of stdin) text += chunk;
    return text;
}

const cliArgs = argv.slice(2);
try {
    if (parseCliArgs(cliArgs).help) {
        stdout.write(`${usage()}\n`);
        exit(0);
    }
} catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${usage()}\n`);
    exit(2);
}

const [
    { neoAgentRuntime },
    { userList },
    { sessionCreate, sessionGetCurrent },
    { newRunId },
] = await Promise.all([
    import('./app/agent-runtime.js'),
    import('./services/user-service.js'),
    import('./services/chat-service.js'),
    import('@neo/runtime'),
]);

const code = await runCli(cliArgs, {
    runtime: neoAgentRuntime,
    userList,
    sessionGetCurrent,
    sessionCreate,
    newRunId,
    readStdin,
    stdout,
    stderr,
});

exit(code);
