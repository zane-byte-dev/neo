import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { loadMcpTools } from '../loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK = join(__dirname, 'fixtures/mock-server.mjs');

let workDir: string;

function writeMcpJson(config: object) {
    workDir = mkdtempSync(join(tmpdir(), 'mcp-loader-'));
    writeFileSync(join(workDir, 'mcp.json'), JSON.stringify(config), 'utf8');
}

afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('loadMcpTools disabledTools enforcement', () => {
    it('registers the echo tool when nothing is disabled', async () => {
        writeMcpJson({
            mcpServers: { mock: { command: process.execPath, args: [MOCK] } },
        });
        const tools = await loadMcpTools(workDir);
        expect([...tools.keys()]).toContain('mcp__mock__echo');
    });

    it('skips a tool listed in disabledTools', async () => {
        writeMcpJson({
            mcpServers: { mock: { command: process.execPath, args: [MOCK] } },
            disabledTools: { mock: ['echo'] },
        });
        const tools = await loadMcpTools(workDir);
        expect([...tools.keys()]).not.toContain('mcp__mock__echo');
        expect(tools.size).toBe(0);
    });
});
