import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { StdioMcpClient } from '../stdio-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK = join(__dirname, 'fixtures/mock-server.mjs');

describe('StdioMcpClient (integration, real child process)', () => {
    let client: StdioMcpClient | null = null;
    afterEach(() => { client?.stop(); client = null; });

    it('initializes, lists, and calls a tool', async () => {
        client = new StdioMcpClient({ command: process.execPath, args: [MOCK], timeoutMs: 5_000 });
        await client.start();
        const tools = await client.listTools();
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('echo');

        const res = await client.callTool('echo', { text: 'hi' });
        expect(res.content?.[0].text).toBe('hi');
    });

    it('surfaces server-reported errors', async () => {
        client = new StdioMcpClient({ command: process.execPath, args: [MOCK], timeoutMs: 5_000 });
        await client.start();
        await expect(client.callTool('missing', {})).rejects.toThrow(/Unknown tool/);
    });
});
