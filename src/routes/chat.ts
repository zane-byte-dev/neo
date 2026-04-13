import { PassThrough } from 'stream';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type Router from '@koa/router';
import { messageList, messageAdd, sessionGet, sessionCreate } from '../services/chat-service.js';
import { LLMClient, ToolContext } from '../llm/client.js';
import { calcUser } from '../services/user-service.js';
import { MAX_INPUT_LENGTH } from '../config.js';
    
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
        if (message.length > MAX_INPUT_LENGTH) {
            ctx.status = 400;
            ctx.body = { error: `message too long (max ${MAX_INPUT_LENGTH} chars)` };
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
            userTools: userCtx.userTools,
            todoCallback: (todos) => {
                write({ type: 'todo_update', todos });
            },
            imageCallback: async (data: string, mimeType: string, caption?: string) => {
                const ext = mimeType.includes('png') ? 'png' : 'jpg';
                const filename = `gen_${Date.now()}.${ext}`;
                const dir = join(userCtx.workDir, '.tmp', sessionId);
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(join(dir, filename), Buffer.from(data, 'base64'));
                const url = `/api/assets/${sessionId}/${filename}`;
                write({ type: 'image', url, ...(caption ? { caption } : {}) });
            },
        };
        const historyRows = await messageList(sessionId, userId);
        const history = historyRows.map(r => `${r.role === 'assistant' ? 'Assistant' : 'User'}: ${r.content}`).join('\n');

        let session = await sessionGet(sessionId, userId);
        if (!session) session = await sessionCreate(userId, sessionId);
        await messageAdd(session.id, userId, 'user', message);

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
                await messageAdd(sessionId, userId, 'assistant', fullResponse);
            }
        }
    });
}


