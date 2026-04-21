#!/usr/bin/env node
/* eslint-disable */
// Minimal MCP-ish JSON-RPC stdio echo server used by stdio-client.test.ts.
// Speaks just enough of MCP to answer: initialize, tools/list, tools/call.

import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let req;
    try { req = JSON.parse(line); } catch { return; }
    if (typeof req.id !== 'number') return; // ignore notifications

    if (req.method === 'initialize') {
        send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '1' } } });
    } else if (req.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: req.id, result: {
            tools: [
                { name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
            ],
        } });
    } else if (req.method === 'tools/call') {
        const { name, arguments: args } = req.params ?? {};
        if (name === 'echo') {
            send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: String(args?.text ?? '') }] } });
        } else {
            send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Unknown tool: ${name}` } });
        }
    } else {
        send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
    }
});
