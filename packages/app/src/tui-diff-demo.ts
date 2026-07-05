#!/usr/bin/env node

import process from 'node:process';
import { TUI, ProcessTerminal, Text, Spacer, matchesKey, Key } from '@earendil-works/pi-tui';
import { DiffConfirm, computeDiffLines } from './cli/diff-confirm.js';

const before = [
    'export function greet(name) {',
    '  return "Hello " + name;',
    '}',
    '',
].join('\n');

const after = [
    'export function greet(name: string): string {',
    '  if (!name) name = "friend";',
    '  return `Hello ${name}`;',
    '}',
    '',
].join('\n');

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

tui.addChild(new Text('Neo · diff-confirm prototype (pi-tui)'));
tui.addChild(new Spacer(1));

const confirm = new DiffConfirm('src/greet.ts', computeDiffLines(before, after));
confirm.onDecision = (decision) => {
    tui.stop();
    process.stdout.write(`\nDecision: ${decision}\n`);
    process.exit(decision === 'reject' ? 1 : 0);
};
tui.addChild(confirm);
tui.setFocus(confirm);

// Raw mode swallows SIGINT — intercept Ctrl+C to exit cleanly.
tui.addInputListener((data) => {
    if (matchesKey(data, Key.ctrl('c'))) {
        tui.stop();
        process.stdout.write('\nAborted.\n');
        process.exit(130);
    }
    return undefined;
});

tui.start();
