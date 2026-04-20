/**
 * src/routes/notebook-chat.ts — Notebook chat routes (source-grounded SSE chat).
 *
 * Handles: streaming chat, chat history, clear, fork.
 */
import type Router from '@koa/router';
import {
    nbReadChatHistory,
    nbClearChatHistory,
    nbForkChatHistory,
} from '../services/notebook-service.js';
import { streamNotebookChat } from '../services/notebook-chat.js';
import { calcUser } from '../services/user-service.js';
import { createSSEResponse } from '../utils/sse.js';

function extractModel(body: Record<string, unknown>): string | undefined {
    return typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
}

// ── GET /api/notebook/chat — Chat history ───────────────────────────────────

export function notebookChatHistory(router: Router): void {
    router.get('/api/notebook/chat', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const nb = q.notebook?.trim();
        if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
        ctx.body = nbReadChatHistory(workDir, nb);
    });
}

// ── POST /api/notebook/chat — Source-grounded chat (SSE) ────────────────────

export function notebookChat(router: Router): void {
    router.post('/api/notebook/chat', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const message = typeof body.message === 'string' ? body.message : '';
        if (!notebook || !message.trim()) { ctx.status = 400; ctx.body = { error: 'notebook + message required' }; return; }

        const selectedSourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined;

        const sse = createSSEResponse(ctx);

        try {
            await streamNotebookChat(workDir, notebook, message, selectedSourceIds, sse.send, sse.signal, extractModel(body));
        } catch (err) {
            sse.send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        } finally {
            sse.close();
        }
    });
}

// ── DELETE /api/notebook/chat — Clear chat history ──────────────────────────

export function notebookClearChat(router: Router): void {
    router.delete('/api/notebook/chat', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const notebook = q.notebook?.trim();
        if (!notebook) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
        nbClearChatHistory(workDir, notebook);
        ctx.body = { ok: true };
    });
}

// ── POST /api/notebook/chat/fork — Fork chat from a message ────────────────

export function notebookForkChat(router: Router): void {
    router.post('/api/notebook/chat/fork', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;
        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
        if (!notebook || !messageId) {
            ctx.status = 400;
            ctx.body = { error: 'notebook and messageId required' };
            return;
        }
        const messages = nbForkChatHistory(workDir, notebook, messageId);
        ctx.body = { messages };
    });
}
