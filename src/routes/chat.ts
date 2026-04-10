import { PassThrough } from 'stream';
import type Router from '@koa/router';
import { getTenantContext } from '../services/tool-context.js';
import { ChatSession } from '../services/chat-service.js';
import type { TenantKey } from '../types/platform.js';
import type { ToolContext } from '../llm/types.js';
import type { RouteContext } from './_base.js';

export function chatRoute(router: Router, { llm }: RouteContext): void {
    router.post('/api/chat', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

        if (!message) {
            ctx.status = 400;
            ctx.body = { error: 'message is required' };
            return;
        }

        const reqUserId: string | undefined = ctx.state.userId;
        const tenantKey = reqUserId ? (`web:${reqUserId}` as TenantKey) : undefined;
        const tenantCtx = tenantKey ? (() => {
            try { return getTenantContext(tenantKey); } catch { return undefined; }
        })() : undefined;

        const stream = new PassThrough();
        ctx.status = 200;
        ctx.set('Content-Type', 'text/event-stream');
        ctx.set('Cache-Control', 'no-cache');
        ctx.set('Connection', 'keep-alive');
        ctx.set('X-Accel-Buffering', 'no');
        ctx.body = stream;

        const abortController = new AbortController();
        const write = (obj: Record<string, unknown>) => {
            if (!stream.destroyed) stream.write(`data: ${JSON.stringify(obj)}\n\n`);
        };

        let toolContext: ToolContext | undefined;
        if (tenantCtx) {
            toolContext = {
                tenantKey: tenantCtx.tenantKey,
                userId: tenantCtx.userId,
                chatId: reqUserId!,
                workDir: tenantCtx.workDir,
                systemInstruction: tenantCtx.systemInstruction,
                adapter: {
                    sendMessage: async (_chatId, text) => {
                        write({ type: 'text', text });
                        return { id: 'web', chatId: _chatId };
                    },
                    sendPhoto: async (_chatId, _photo, caption) => {
                        if (caption) write({ type: 'text', text: caption });
                        return { id: 'web', chatId: _chatId };
                    },
                },
                skillRegistry: tenantCtx.skillRegistry,
                imageCallback: async (data, mimeType, caption) => {
                    write({ type: 'image', data, mimeType, ...(caption ? { caption } : {}) });
                },
            };
        }

        const cache = reqUserId ? new ChatSession(reqUserId) : undefined;
        if (cache) cache.addMessage('user', message);
        const history = cache?.getHistoryText() ?? '';

        let fullResponse = '';
        try {
            await llm.chatWithContextStreaming(
                message,
                history,
                (chunk) => {
                    write(chunk as Record<string, unknown>);
                    if ((chunk as { type: string; text?: string }).type === 'text') {
                        fullResponse += (chunk as { text?: string }).text ?? '';
                    }
                },
                abortController.signal,
                toolContext,
                model,
            );
            write({ type: 'done' });
        } catch (err: unknown) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                write({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
        } finally {
            stream.end();
            if (fullResponse && cache) {
                cache.addMessage('assistant', fullResponse);
            }
        }
    });
}

export function register(router: Router, ctx: RouteContext): void {
    chatRoute(router, ctx);
}
