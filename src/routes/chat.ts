import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type Router from '@koa/router';
import { runAgentTurn } from '../services/agent-runner.js';
import { calcUser } from '../services/user-service.js';
import { MAX_INPUT_LENGTH } from '../config.js';
import { createSSEResponse } from '../utils/sse.js';
import { createConfirm } from '../utils/pending-confirm.js';
import { newRunId } from '../runtime/store.js';

export function chatRoute(router: Router): void {
    router.post('/api/chat', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
        const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
        const images = Array.isArray(body.images) ? (body.images as unknown[]).filter((v): v is string => typeof v === 'string' && v.startsWith('data:image/')) : undefined;
        // Document attachments: array of { filename, text } extracted on the client via /api/upload
        const documents = Array.isArray(body.documents)
            ? (body.documents as unknown[]).filter((v): v is { filename: string; text: string } =>
                typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).filename === 'string' && typeof (v as Record<string, unknown>).text === 'string')
            : undefined;
        const confirmDangerous = body.confirmDangerous === true;
        if (!message && (!images || images.length === 0) && (!documents || documents.length === 0)) {
            ctx.status = 400;
            ctx.body = { error: 'message, images, or documents required' };
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

        const sse = createSSEResponse(ctx);

        try {
            // Build message with document context if present
            let effectiveMessage = message;
            if (documents?.length) {
                const docContext = documents.map((d) =>
                    `[Attached File: ${d.filename}]\n${d.text}`
                ).join('\n\n---\n\n');
                effectiveMessage = effectiveMessage
                    ? `${effectiveMessage}\n\n---\n\n${docContext}`
                    : docContext;
            }

            // Pre-allocate a runId so the client receives it on the
            // first SSE frame and can later subscribe to events / cancel
            // the run via the /api/runs API.
            const runId = newRunId();
            sse.send({ type: 'run', runId });

            await runAgentTurn({
                userId,
                sessionId,
                runId,
                entrypoint: 'web-chat',
                triggerType: 'user_message',
                message: effectiveMessage,
                model,
                images: images?.length ? images : undefined,
                signal: sse.signal,
                onChunk: (chunk) => sse.send(chunk as Record<string, unknown>),
                onTodo: (todos) => sse.send({ type: 'todo_update', todos }),
                confirmCallback: confirmDangerous
                    ? async ({ toolName, args }) => {
                        const { confirmId, promise } = createConfirm(userId, {
                            signal: sse.signal,
                            runId,
                            workDir: userCtx.workDir,
                            request: { toolName, args },
                        });
                        sse.send({ type: 'tool_confirm', confirmId, runId, actionId: confirmId, toolName, args });
                        return promise;
                    }
                    : undefined,
                onImage: async (data, mimeType, caption) => {
                    const ext = mimeType.includes('png') ? 'png' : 'jpg';
                    const filename = `gen_${Date.now()}.${ext}`;
                    const dir = join(userCtx.workDir, '.neo', 'projects', sessionId);
                    await fs.mkdir(dir, { recursive: true });
                    await fs.writeFile(join(dir, filename), Buffer.from(data, 'base64'));
                    const url = `/api/assets/${sessionId}/${filename}`;
                    sse.send({ type: 'image', url, ...(caption ? { caption } : {}) });
                },
                onVideo: async (url) => {
                    sse.send({ type: 'video', url });
                },
            });
            sse.send({ type: 'done' });
        } catch (err: unknown) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                sse.send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
        } finally {
            sse.close();
        }
    });
}


