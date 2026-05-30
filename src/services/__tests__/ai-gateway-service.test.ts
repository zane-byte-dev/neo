import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
    generateText: vi.fn(),
    streamText: vi.fn(),
    recordTokenUsage: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
        ...actual,
        generateText: mocks.generateText,
        streamText: mocks.streamText,
    };
});

vi.mock('../../utils/token-tracker.js', () => ({
    recordTokenUsage: mocks.recordTokenUsage,
}));

vi.mock('../../llm/model-factory.js', () => ({
    createLanguageModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock' })),
    isAcpModel: vi.fn((modelId: string) => modelId.startsWith('acp/')),
    resolveModel: vi.fn((model: string) => model === 'gemma' ? 'ollama/gemma4:e4b' : model),
}));

function usage(inputTokens = 3, outputTokens = 4) {
    return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: outputTokens, reasoningTokens: undefined },
    };
}

let previousUsers: string | undefined;
let workDir: string;

beforeEach(() => {
    previousUsers = process.env.USERS;
    workDir = mkdtempSync(join(tmpdir(), 'gateway-service-'));
    process.env.USERS = JSON.stringify([{ id: 'u1', name: 'User', gatewayToken: 'gw-token', workDir, stateDir: workDir }]);
    mocks.generateText.mockReset();
    mocks.streamText.mockReset();
    mocks.recordTokenUsage.mockReset();
});

afterEach(() => {
    if (previousUsers === undefined) delete process.env.USERS;
    else process.env.USERS = previousUsers;
    rmSync(workDir, { recursive: true, force: true });
});

describe('ai gateway service', () => {
    it('lists Neo aliases and canonical provider model ids for model discovery', async () => {
        const { getGatewayModels } = await import('../ai-gateway-service.js');

        const response = await getGatewayModels() as { data: Array<{ id: string; created: number; owned_by: string; x_neo: { modelId: string; alias?: string } }> };

        expect(response.data).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'auto', created: 1, owned_by: 'neo' }),
            expect.objectContaining({ id: 'gemma', created: 1, owned_by: 'ollama', x_neo: expect.objectContaining({ modelId: 'ollama/gemma4:e4b', alias: 'gemma' }) }),
            expect.objectContaining({ id: 'ollama/gemma4:e4b', created: 1, owned_by: 'ollama', x_neo: expect.objectContaining({ modelId: 'ollama/gemma4:e4b', alias: 'gemma' }) }),
        ]));
        // claude-opus-4.7 should NOT appear without claudeCompat flag
        expect(response.data.map((m) => m.id)).not.toContain('claude-opus-4.7');
    });

    it('includes claude-opus-4.7 virtual entry when claudeCompat is requested', async () => {
        const { getGatewayModels } = await import('../ai-gateway-service.js');

        const response = await getGatewayModels({ claudeCompat: true }) as { data: Array<{ id: string; owned_by: string; x_neo: { modelId: string; virtual?: boolean } }> };

        const entry = response.data.find((m) => m.id === 'claude-opus-4.7');
        expect(entry).toEqual(expect.objectContaining({
            id: 'claude-opus-4.7',
            owned_by: 'anthropic',
            x_neo: expect.objectContaining({ modelId: 'auto', virtual: true }),
        }));
    });

    it('creates OpenAI-compatible completions and records gateway usage', async () => {
        mocks.generateText.mockResolvedValue({
            text: 'hello',
            content: [{ type: 'text', text: 'hello' }],
            finishReason: 'stop',
            usage: usage(),
            totalUsage: usage(),
        });
        const { createOpenAIChatCompletion } = await import('../ai-gateway-service.js');

        const response = await createOpenAIChatCompletion({
            model: 'gemma',
            messages: [{ role: 'user', content: 'hi' }],
        }, { userId: 'u1' }) as { model: string; choices: Array<{ message: { content: string } }> };

        expect(response.model).toBe('ollama/gemma4:e4b');
        expect(response.choices[0].message.content).toBe('hello');
        expect(mocks.recordTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ caller: 'ai-gateway:openai' }));

        const history = await fs.readFile(join(workDir, 'usage.jsonl'), 'utf8');
        expect(history).toContain('"caller":"ai-gateway:openai"');
        expect(history).toContain('"model":"ollama/gemma4:e4b"');
    });

    it('returns Anthropic tool_use blocks without executing tools', async () => {
        mocks.generateText.mockResolvedValue({
            text: '',
            content: [{ type: 'tool-call', toolCallId: 'toolu_1', toolName: 'read_file', input: { path: 'package.json' } }],
            finishReason: 'tool-calls',
            usage: usage(),
            totalUsage: usage(),
        });
        const { createAnthropicMessage } = await import('../ai-gateway-service.js');

        const response = await createAnthropicMessage({
            model: 'gemma',
            tools: [{ name: 'read_file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
            messages: [{ role: 'user', content: 'read package.json' }],
        }, { userId: 'u1' }) as { content: Array<{ type: string; id?: string; name?: string; input?: unknown }> };

        expect(response.content[0]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'package.json' } });
        expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ tools: expect.objectContaining({ read_file: expect.any(Object) }) }));
        expect(mocks.recordTokenUsage).toHaveBeenCalledWith(expect.objectContaining({ caller: 'ai-gateway:anthropic' }));
    });
});