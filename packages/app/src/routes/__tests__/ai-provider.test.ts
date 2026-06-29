import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp } from '../../__tests__/test-helpers.js';

const getModelsMock = vi.fn();
const createOpenAIChatCompletionMock = vi.fn();
const streamOpenAIChatCompletionMock = vi.fn();
const createAnthropicMessageMock = vi.fn();
const streamAnthropicMessageMock = vi.fn();

vi.mock('@neo/agent/services/ai-provider-service.js', () => ({
    getModels: getModelsMock,
    createOpenAIChatCompletion: createOpenAIChatCompletionMock,
    streamOpenAIChatCompletion: streamOpenAIChatCompletionMock,
    createAnthropicMessage: createAnthropicMessageMock,
    streamAnthropicMessage: streamAnthropicMessageMock,
}));

async function* chunks(...items: string[]): AsyncGenerator<string> {
    for (const item of items) yield item;
}

let previousUsers: string | undefined;
let workDir: string;

beforeEach(() => {
    previousUsers = process.env.USERS;
    workDir = mkdtempSync(join(tmpdir(), 'provider-route-'));
    process.env.USERS = JSON.stringify([{ id: 'u1', name: 'User', apiToken: 'gw-token', workDir, stateDir: workDir }]);
    getModelsMock.mockResolvedValue({ object: 'list', data: [{ id: 'auto' }] });
    createOpenAIChatCompletionMock.mockResolvedValue({ id: 'chatcmpl-test', choices: [] });
    streamOpenAIChatCompletionMock.mockReturnValue(chunks('data: {"ok":true}\n\n', 'data: [DONE]\n\n'));
    createAnthropicMessageMock.mockResolvedValue({ id: 'msg_test', type: 'message' });
    streamAnthropicMessageMock.mockReturnValue(chunks('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
});

afterEach(() => {
    if (previousUsers === undefined) delete process.env.USERS;
    else process.env.USERS = previousUsers;
    rmSync(workDir, { recursive: true, force: true });
    vi.clearAllMocks();
});

describe('/v1 provider routes', () => {
    it('returns 403 when API token is not configured', async () => {
        process.env.USERS = JSON.stringify([{ id: 'u1', name: 'User', workDir, stateDir: workDir }]);
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const res = await request(app.callback()).get('/v1/models').set('Authorization', 'Bearer gw-token');
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('api_disabled');
        expect(getModelsMock).not.toHaveBeenCalled();
    });

    it('requires a Bearer token', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const res = await request(app.callback()).get('/v1/models');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('missing_api_token');
    });

    it('rejects an invalid Bearer token', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const res = await request(app.callback()).get('/v1/models').set('Authorization', 'Bearer wrong');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('invalid_api_token');
    });

    it('returns model list with a valid API token', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const res = await request(app.callback()).get('/v1/models').set('Authorization', 'Bearer gw-token');
        expect(res.status).toBe(200);
        expect(res.body.data[0].id).toBe('auto');
        expect(getModelsMock).toHaveBeenCalledTimes(1);
    });

    it('does not require Basic Auth on provider routes', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp({ basicAuthUser: 'admin', basicAuthPass: 'secret' });
        aiProvider(router); mount();

        const res = await request(app.callback()).get('/v1/models').set('Authorization', 'Bearer gw-token');
        expect(res.status).toBe(200);
    });

    it('routes OpenAI non-streaming requests to the provider service', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const body = { model: 'auto', messages: [{ role: 'user', content: 'hi' }] };
        const res = await request(app.callback())
            .post('/v1/chat/completions')
            .set('Authorization', 'Bearer gw-token')
            .send(body);

        expect(res.status).toBe(200);
        expect(createOpenAIChatCompletionMock).toHaveBeenCalledWith(body, expect.objectContaining({ userId: 'u1' }));
    });

    it('streams OpenAI SSE chunks', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const res = await request(app.callback())
            .post('/v1/chat/completions')
            .set('Authorization', 'Bearer gw-token')
            .send({ model: 'auto', stream: true, messages: [{ role: 'user', content: 'hi' }] });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.text).toContain('data: [DONE]');
        expect(streamOpenAIChatCompletionMock).toHaveBeenCalled();
    });

    it('routes Anthropic non-streaming requests to the provider service', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const body = { model: 'deepseek', messages: [{ role: 'user', content: 'hi' }] };
        const res = await request(app.callback())
            .post('/v1/messages')
            .set('Authorization', 'Bearer gw-token')
            .send(body);

        expect(res.status).toBe(200);
        expect(createAnthropicMessageMock).toHaveBeenCalledWith(body, expect.objectContaining({ userId: 'u1' }));
    });

    it('streams Anthropic SSE events', async () => {
        const { aiProvider } = await import('../ai-provider.js');
        const { app, router, mount } = createTestApp();
        aiProvider(router); mount();

        const res = await request(app.callback())
            .post('/v1/messages')
            .set('Authorization', 'Bearer gw-token')
            .send({ model: 'deepseek', stream: true, messages: [{ role: 'user', content: 'hi' }] });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.text).toContain('event: message_stop');
        expect(streamAnthropicMessageMock).toHaveBeenCalled();
    });
});
