import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PiRpcBridge } from '../pi-rpc-bridge.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-pi-rpc.mjs', import.meta.url));

describe('PiRpcBridge', () => {
    it('starts, correlates responses, streams events, and waits for agent_settled', async () => {
        const bridge = new PiRpcBridge({
            executable: process.execPath,
            executableArgs: [fixture],
            cwd: process.cwd(),
            startupTimeoutMs: 2_000,
        });
        const eventTypes: unknown[] = [];
        bridge.onEvent((event) => eventTypes.push(event.type));

        await bridge.start();
        const settled = await bridge.promptAndWait('make a report', { timeoutMs: 2_000 });
        expect(settled.type).toBe('agent_settled');
        expect(eventTypes).toEqual([
            'agent_start',
            'tool_execution_start',
            'tool_execution_end',
            'message_update',
            'agent_settled',
        ]);
        await expect(bridge.abort()).resolves.toBeUndefined();
        await bridge.stop();
    });

    it('reports unsupported RPC commands', async () => {
        const bridge = new PiRpcBridge({
            executable: process.execPath,
            executableArgs: [fixture],
            cwd: process.cwd(),
            startupTimeoutMs: 2_000,
        });
        await bridge.start();
        await expect(bridge.send('unknown')).rejects.toThrow('unsupported command');
        await bridge.stop();
    });
});
