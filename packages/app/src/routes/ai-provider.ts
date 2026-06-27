import type Koa from 'koa';
import type Router from '@koa/router';
import { getModels, createOpenAIChatCompletion, streamOpenAIChatCompletion, createAnthropicMessage, streamAnthropicMessage, countAnthropicTokens } from '@neo/agent/services/ai-provider-service.js';
import { GatewayError, toGatewayError } from '@neo/agent/llm/protocol/errors.js';
import { encodeOpenAIError, encodeOpenAIErrorEvent } from '@neo/agent/llm/protocol/openai.js';
import { encodeAnthropicError, encodeAnthropicErrorEvent } from '@neo/agent/llm/protocol/anthropic.js';

function requestBody(ctx: Koa.Context): Record<string, unknown> {
    return (ctx.request.body && typeof ctx.request.body === 'object') ? ctx.request.body as Record<string, unknown> : {};
}

function prepareSse(ctx: Koa.Context): void {
    ctx.respond = false;
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    ctx.res.setHeader('Cache-Control', 'no-cache, no-transform');
    ctx.res.setHeader('Connection', 'keep-alive');
    ctx.res.flushHeaders?.();
}

function callContext(ctx: Koa.Context): { userId: string; abortSignal: AbortSignal } {
    const ctrl = new AbortController();
    ctx.req.on('close', () => ctrl.abort());
    return { userId: ctx.state.userId as string, abortSignal: ctrl.signal };
}

async function writeStream(ctx: Koa.Context, stream: AsyncGenerator<string>, onError: (err: GatewayError) => string): Promise<void> {
    prepareSse(ctx);
    try {
        for await (const chunk of stream) ctx.res.write(chunk);
    } catch (err) {
        ctx.res.write(onError(toGatewayError(err)));
    } finally {
        ctx.res.end();
    }
}

export function aiProvider(router: Router): void {
    router.get('/v1/models', async (ctx) => {
        ctx.body = await getModels();
    });

    router.post('/v1/chat/completions', async (ctx) => {
        const body = requestBody(ctx);
        const callCtx = callContext(ctx);
        if (body.stream === true) {
            await writeStream(ctx, streamOpenAIChatCompletion(body, callCtx), encodeOpenAIErrorEvent);
            return;
        }
        try {
            ctx.body = await createOpenAIChatCompletion(body, callCtx);
        } catch (err) {
            const e = toGatewayError(err);
            ctx.status = e.status;
            ctx.body = encodeOpenAIError(e);
        }
    });

    router.post('/v1/messages', async (ctx) => {
        const body = requestBody(ctx);
        const callCtx = callContext(ctx);
        if (body.stream === true) {
            await writeStream(ctx, streamAnthropicMessage(body, callCtx), encodeAnthropicErrorEvent);
            return;
        }
        try {
            ctx.body = await createAnthropicMessage(body, callCtx);
        } catch (err) {
            const e = toGatewayError(err);
            ctx.status = e.status;
            ctx.body = encodeAnthropicError(e);
        }
    });

    router.post('/v1/messages/count_tokens', (ctx) => {
        try {
            ctx.body = countAnthropicTokens(requestBody(ctx));
        } catch (err) {
            const e = toGatewayError(err);
            ctx.status = e.status;
            ctx.body = encodeAnthropicError(e);
        }
    });
}
