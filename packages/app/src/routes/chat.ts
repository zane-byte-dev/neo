import { randomUUID } from 'node:crypto';
import type Router from '@koa/router';
import { calcUser } from '@neo/agent/services/user-service.js';
import { sessionGet, sessionGetByNotebook, sessionCreate, sessionPatch } from '@neo/agent/services/chat-service.js';
import { MAX_INPUT_LENGTH } from '@neo/agent/config.js';
import { createSSEResponse } from '../utils/sse.js';
import { runPiChat } from '../services/pi-chat.js';

export function chatRoute(router: Router): void {
    router.post('/api/chat', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
        let sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
        const notebookId = typeof body.notebookId === 'string' && body.notebookId.trim() ? body.notebookId.trim() : undefined;
        const rawSourceIds = Array.isArray(body.sourceIds)
            ? (body.sourceIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
            : undefined;
        const images = Array.isArray(body.images) ? (body.images as unknown[]).filter((v): v is string => typeof v === 'string' && v.startsWith('data:image/')) : undefined;
        // Document attachments: array of { filename, text } extracted on the client via /api/upload
        const documents = Array.isArray(body.documents)
            ? (body.documents as unknown[]).filter((v): v is { filename: string; text: string } =>
                typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).filename === 'string' && typeof (v as Record<string, unknown>).text === 'string')
            : undefined;
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

        const userId = ctx.state.userId;

        // Notebook mode: resolve / create the implicit notebook session before running.
        if (notebookId) {
            let nbSession = await sessionGetByNotebook(userId, notebookId);
            if (!nbSession) {
                nbSession = await sessionCreate(userId, undefined, {
                    mode: 'notebook',
                    notebookId,
                    title: `Notebook: ${notebookId}`,
                    ...(rawSourceIds && rawSourceIds.length > 0 ? { sourceIds: rawSourceIds } : {}),
                });
            } else if (rawSourceIds !== undefined) {
                // Sync latest source selection onto the bound session.
                await sessionPatch(nbSession.id, userId, { source_ids: rawSourceIds });
            }
            sessionId = nbSession.id;
        } else if (sessionId && rawSourceIds !== undefined) {
            // Allow callers to update sourceIds for an existing notebook-mode session.
            const existing = await sessionGet(sessionId, userId);
            if (existing?.mode === 'notebook') {
                await sessionPatch(sessionId, userId, { source_ids: rawSourceIds });
            }
        }

        if (!sessionId) {
            ctx.status = 400;
            ctx.body = { error: 'sessionId is required' };
            return;
        }

        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir ?? userCtx.workDir;

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

            if (notebookId) {
                const selectedSourceIds = rawSourceIds ?? (await sessionGet(sessionId, userId))?.source_ids ?? [];
                effectiveMessage = `[Neo Notebook Context]
Notebook: ${notebookId}
Selected source IDs: ${selectedSourceIds.length > 0 ? selectedSourceIds.join(', ') : '(all sources)'}
Use knowledge_search and knowledge_get to ground the answer in workspace Markdown. The search results include citation labels such as 【1】; cite factual claims with those labels. Use artifact_save only when the user asks for a durable report/article/artifact.
[/Neo Notebook Context]

${effectiveMessage}`;
            }

            // Pre-allocate a runId so the client receives it on the
            // first SSE frame and can later subscribe to events / cancel
            // the run via the /api/runs API.
            const runId = `run_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
            // Notify client of the (possibly auto-resolved notebook) session id.
            if (notebookId) sse.send({ type: 'session', sessionId });
            sse.send({ type: 'run', runId });

            await runPiChat({
                userId,
                stateDir,
                workspaceRoot: userCtx.workDir,
                sessionId,
                runId,
                message: effectiveMessage,
                model,
                signal: sse.signal,
                send: sse.send,
            });
        } catch (err: unknown) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                const text = err instanceof Error ? err.message : String(err);
                if (!sse.signal.aborted) {
                    sse.send({ type: 'error', text });
                }
            }
        } finally {
            sse.close();
        }
    });
}
