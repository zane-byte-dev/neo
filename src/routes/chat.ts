import { PassThrough } from 'stream';
import type Router from '@koa/router';
import { ChatSession, getGeminiHistory, messageAdd, sessionGet } from '../services/chat-service.js';
import { LLMClient, ToolContext } from '../llm/client.js';
import { calcUser } from '../services/user-service.js';
import { get } from 'http';
    
const llm = new LLMClient();

export function chatRoute(router: Router): void {
    router.post('/api/chat', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
        const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
        if (!message) {
            ctx.status = 400;
            ctx.body = { error: 'message is required' };
            return;
        }

        if (!sessionId){
            ctx.status = 400;
            ctx.body = { error: 'sessionId is required' };
            return;
        }

        const userId = ctx.state.userId;
        const userCtx = await calcUser(userId);
        
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

        let toolContext:ToolContext = {
            userId,
            sessionId,
            workDir: userCtx.workDir,
            systemInstruction: userCtx.systemInstruction,
            skillRegistry: userCtx.skillRegistry,
        };
        const session = sessionGet(sessionId, userId);
        if (session) messageAdd(session.id, userId, 'user', message);

        const history = getGeminiHistory(sessionId, userId);

        let fullResponse = '';
        try {
            await llm.chatWithContextStreaming(
                message,
                history,
                toolContext,
                (chunk) => {
                    write(chunk as Record<string, unknown>);
                    if ((chunk as { type: string; text?: string }).type === 'text') {
                        fullResponse += (chunk as { text?: string }).text ?? '';
                    }
                },
                abortController.signal,
                model,
            );
            write({ type: 'done' });
        } catch (err: unknown) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                write({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
        } finally {
            stream.end();
            if (fullResponse) {
                messageAdd(sessionId, userId, 'assistant', fullResponse);
            }
        }
    });
}


