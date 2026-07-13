import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiRpcBridge, type PiRpcMessage } from '../services/pi-rpc-bridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = process.env.ATM_WORKSPACE_ROOT ?? resolve(here, '../../../../../workspace/workspace');
const extension = resolve(here, '../pi/extensions/atm-tools.ts');
const providerExtension = process.env.PI_PROVIDER_EXTENSION;
const skills = resolve(here, '../../../../pi/skills');
const sessionDir = process.env.PI_SPIKE_SESSION_DIR ?? '/private/tmp/neo-pi-spike-sessions';
const atmExecutable = process.env.ATM_EXECUTABLE ?? 'atm';

const prompt = '/skill:notebook-report 基于 Notebook 中的“ifs 视频专家调研任务”，生成一份给技术负责人的简明集成可行性报告。';

const bridge = new PiRpcBridge({
    cwd: workspace,
    extensionPaths: [extension, ...(providerExtension ? [providerExtension] : [])],
    sessionDir,
    env: {
        ATM_EXECUTABLE: atmExecutable,
        ATM_WORKSPACE_ROOT: workspace,
    },
    extraArgs: ['--no-approve', '--no-skills', '--skill', skills],
});

const toolNames: string[] = [];
let finalText = '';
let artifactPath = '';
const errors: PiRpcMessage[] = [];

bridge.onEvent((event) => {
    if (event.type === 'tool_execution_start' && typeof event.toolName === 'string') {
        toolNames.push(event.toolName);
        process.stderr.write(`[tool] ${event.toolName}\n`);
    }
    if (event.type === 'tool_execution_end' && event.toolName === 'artifact_save') {
        const result = event.result as { details?: { path?: unknown } } | undefined;
        if (typeof result?.details?.path === 'string') artifactPath = result.details.path;
    }
    if (event.type === 'message_update') {
        const update = event.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
        if (update?.type === 'text_delta' && typeof update.delta === 'string') finalText += update.delta;
        if (update?.type === 'error') errors.push(event);
    }
    if (event.type === 'extension_error') errors.push(event);
});

try {
    await bridge.start();
    await bridge.promptAndWait(prompt, { timeoutMs: 10 * 60_000 });
    for (const required of ['knowledge_search', 'knowledge_get', 'artifact_save']) {
        if (!toolNames.includes(required)) throw new Error(`spike did not call required tool: ${required}`);
    }
    if (!artifactPath) throw new Error('artifact_save completed without a path');
    await access(artifactPath);
    if (errors.length > 0) throw new Error(`spike emitted ${errors.length} error event(s)`);
    process.stdout.write(`${JSON.stringify({
        success: true,
        workspace,
        sessionDir,
        toolNames,
        artifactPath,
        finalText,
    }, null, 2)}\n`);
} finally {
    await bridge.stop();
}
