/**
 * assets.ts — Serve per-user generated files from stateDir/projects directory.
 *
 * Route: GET /api/assets/:sessionId/:filename
 * Auth: enforced by the global _authMiddleware in server.ts (session cookie).
 *
 * Files live at: {userStateDir}/projects/{sessionId}/{filename}
 */
import { createReadStream, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type Router from '@koa/router';
import { calcUser } from '@neo/agent/services/user-service.js';

const MIME_MAP: Record<string, string> = {
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif:  'image/gif',
    mp4:  'video/mp4',
    webm: 'video/webm',
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt:  'text/plain',
    md:   'text/markdown',
    csv:  'text/csv',
    json: 'application/json',
};

export function assetsRoute(router: Router): void {
    router.get('/api/assets/:sessionId/:filename', async (ctx) => {
        const sessionId = (ctx.params.sessionId ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
        // basename strips any directory components — prevents path traversal
        const filename = basename(ctx.params.filename ?? '');

        if (!sessionId || !filename) {
            ctx.status = 400;
            return;
        }

        const userId = ctx.state.userId as string;
        const userCtx = await calcUser(userId);
        const filePath = join(userCtx.stateDir ?? userCtx.workDir, 'projects', sessionId, filename);

        if (!existsSync(filePath)) {
            ctx.status = 404;
            return;
        }

        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        ctx.type = MIME_MAP[ext] ?? 'application/octet-stream';
        ctx.set('Cache-Control', 'private, max-age=86400');
        ctx.body = createReadStream(filePath);
    });
}
