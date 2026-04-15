import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type Router from '@koa/router';
import type { ServerResponse } from 'node:http';
import { runAgentTurn } from '../services/agent-runner.js';
import { calcUser } from '../services/user-service.js';
import { MAX_INPUT_LENGTH } from '../config.js';

export function chatRoute(router: Router): void {
    router.post('/api/chat', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
        const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
        const images = Array.isArray(body.images) ? (body.images as unknown[]).filter((v): v is string => typeof v === 'string' && v.startsWith('data:image/')) : undefined;
        if (!message && (!images || images.length === 0)) {
            ctx.status = 400;
            ctx.body = { error: 'message or images required' };
            return;
        }
        if (message.length > MAX_INPUT_LENGTH) {
            ctx.status = 400;
            ctx.body = { error: `message too long (max ${MAX_INPUT_LENGTH} chars)` };
            return;
        }
        if (!sessionId) {
            ctx.status = 400;
            ctx.body = { error: 'sessionId is required' };
            return;
        }

        const userId = ctx.state.userId;
        const userCtx = await calcUser(userId);

        // Bypass Koa's response handling — write directly to the raw Node.js
        // ServerResponse so SSE events are flushed immediately instead of being
        // buffered until the handler finishes.
        const res: ServerResponse = ctx.res;
        ctx.respond = false;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        const abortController = new AbortController();
        const write = (obj: Record<string, unknown>) => {
            if (!res.destroyed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
        };

        try {
            await runAgentTurn({
                userId,
                sessionId,
                message,
                model,
                images: images?.length ? images : undefined,
                signal: abortController.signal,
                onChunk: (chunk) => write(chunk as Record<string, unknown>),
                onTodo: (todos) => write({ type: 'todo_update', todos }),
                onImage: async (data, mimeType, caption) => {
                    const ext = mimeType.includes('png') ? 'png' : 'jpg';
                    const filename = `gen_${Date.now()}.${ext}`;
                    const dir = join(userCtx.workDir, '.tmp', sessionId);
                    await fs.mkdir(dir, { recursive: true });
                    await fs.writeFile(join(dir, filename), Buffer.from(data, 'base64'));
                    const url = `/api/assets/${sessionId}/${filename}`;
                    write({ type: 'image', url, ...(caption ? { caption } : {}) });
                },
            });
            write({ type: 'done' });
        } catch (err: unknown) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                write({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
        } finally {
            res.end();
        }
    });
}


