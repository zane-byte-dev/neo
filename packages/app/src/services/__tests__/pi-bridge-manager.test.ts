import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PiBridgeManager } from '../pi-bridge-manager.js';
import { PiRpcBridge, type PiRpcBridgeOptions } from '../pi-rpc-bridge.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-pi-rpc.mjs', import.meta.url));

describe('PiBridgeManager', () => {
    it('persists and resumes the Neo to pi session mapping', async () => {
        const stateDir = await fs.mkdtemp('/private/tmp/neo-pi-manager-');
        const created: PiRpcBridgeOptions[] = [];
        const manager = new PiBridgeManager({
            atmExtensionPath: '/tmp/atm-extension.ts',
            atxExtensionPath: '/tmp/atx-extension.ts',
            skillPaths: ['/tmp/neo-skills'],
            defaultModel: { provider: 'atx', id: 'content-model' },
            bridgeFactory: (options) => {
                const fakeOptions = { ...options, executable: process.execPath, executableArgs: [fixture] };
                created.push(fakeOptions);
                return new PiRpcBridge(fakeOptions);
            },
        });
        const events: unknown[] = [];
        await manager.run({
            stateDir,
            workspaceRoot: process.cwd(),
            neoSessionId: 'neo/session:1',
            message: 'hello',
            onEvent: (event) => events.push(event.type),
        });
        await manager.shutdown();
        expect(events).toContain('agent_settled');
        expect(events).toContain('model_selected');
        expect(created[0]?.extraArgs).toEqual(expect.arrayContaining(['--no-skills', '--skill', '/tmp/neo-skills']));
        expect(created[0]?.extensionPaths).toEqual(['/tmp/atm-extension.ts', '/tmp/atx-extension.ts']);

        const mappingPath = `${stateDir}/pi-sessions/mappings/neo_session_1.json`;
        const mapping = JSON.parse(await fs.readFile(mappingPath, 'utf8')) as { piSessionId: string; piSessionFile: string };
        expect(mapping).toMatchObject({ piSessionId: 'fake-session', piSessionFile: '/tmp/fake-session.jsonl' });

        const resumed: PiRpcBridgeOptions[] = [];
        const second = new PiBridgeManager({
            atmExtensionPath: '/tmp/atm-extension.ts',
            bridgeFactory: (options) => {
                const fakeOptions = { ...options, executable: process.execPath, executableArgs: [fixture] };
                resumed.push(fakeOptions);
                return new PiRpcBridge(fakeOptions);
            },
        });
        await second.run({ stateDir, workspaceRoot: process.cwd(), neoSessionId: 'neo/session:1', message: 'again', onEvent: () => {} });
        expect(resumed[0]?.extraArgs).toContain('/tmp/fake-session.jsonl');
        await second.shutdown();
        await fs.rm(stateDir, { recursive: true, force: true });
        expect(created).toHaveLength(1);
    });
});
