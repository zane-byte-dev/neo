/**
 * src/routes/notebook-source.ts — Source management routes for notebooks.
 *
 * Handles: import, guide generation, archive, rename, and source read queries.
 */
import type Router from '@koa/router';
import {
    nbListSources,
    nbListSourcesWithGuides,
    nbGetSourceEntry,
    nbGetSourceGuide,
    nbImportSource,
    nbArchiveSource,
    nbRenameSource,
} from '../services/notebook-service.js';
import { generateAndSaveSourceGuide } from '../services/notebook-ai.js';
import { parseUrl, parseYouTube, isYouTubeUrl } from '../services/document-parser.js';
import { calcUser } from '../services/user-service.js';
import { log } from '../utils/logger.js';

function extractModel(body: Record<string, unknown>): string | undefined {
    return typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
}

// ── GET /api/notebook/source — Read-only source queries ─────────────────────

export function notebookSourceGet(router: Router): void {
    router.get('/api/notebook/source', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;

        switch (q.action) {
            case 'list': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbListSources(workDir, nb);
                break;
            }
            case 'list-with-guides': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbListSourcesWithGuides(workDir, nb);
                break;
            }
            case 'read': {
                const nb = q.notebook?.trim();
                const sid = q.sourceId?.trim();
                if (!nb || !sid) { ctx.status = 400; ctx.body = { error: 'notebook + sourceId required' }; return; }
                const entry = nbGetSourceEntry(workDir, nb, sid);
                if (!entry) { ctx.status = 404; ctx.body = { error: 'Source not found' }; return; }
                ctx.body = entry;
                break;
            }
            case 'guide': {
                const nb = q.notebook?.trim();
                const sid = q.sourceId?.trim();
                if (!nb || !sid) { ctx.status = 400; ctx.body = { error: 'notebook + sourceId required' }; return; }
                const guide = nbGetSourceGuide(workDir, nb, sid);
                ctx.body = guide ?? null;
                break;
            }
            default:
                ctx.status = 400;
                ctx.body = { error: `Unknown source action: ${q.action ?? '(none)'}` };
        }
    });
}

// ── POST /api/notebook/import — Import source ──────────────────────────────

export function notebookImportSource(router: Router): void {
    router.post('/api/notebook/import', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' && body.notebook.trim() ? body.notebook.trim() : 'personal';
        const kind = typeof body.kind === 'string' ? body.kind : 'text';

        try {
            let title = '';
            let content = '';
            let source: string | null = null;
            let type: 'text' | 'url' | 'youtube' | 'pdf' | 'audio' | 'image' = 'text';

            if (kind === 'url') {
                const url = typeof body.url === 'string' ? body.url.trim() : '';
                if (!url) { ctx.status = 400; ctx.body = { error: 'url required' }; return; }

                if (isYouTubeUrl(url)) {
                    const p = await parseYouTube(url);
                    title = p.title;
                    content = p.text;
                    source = p.url;
                    type = 'youtube';
                } else {
                    const p = await parseUrl(url);
                    title = p.title;
                    content = p.text;
                    source = p.url;
                    type = /\.pdf(\?|$)/i.test(url) ? 'pdf' : 'url';
                }
            } else if (kind === 'text') {
                title = typeof body.title === 'string' ? body.title.trim() : '';
                content = typeof body.content === 'string' ? body.content : '';
                source = typeof body.source === 'string' ? body.source : null;
                if (!title) title = content.slice(0, 40).replace(/\n.*/s, '').trim() || 'Untitled';
                type = 'text';
            } else if (kind === 'document') {
                // Pre-parsed content (from /api/upload)
                title = typeof body.title === 'string' ? body.title.trim() :
                    typeof body.filename === 'string' ? body.filename.replace(/\.[^.]+$/, '') : 'Untitled';
                content = typeof body.content === 'string' ? body.content : '';
                source = typeof body.filename === 'string' ? body.filename : null;
                const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
                if (mimeType.includes('pdf') || /\.pdf$/i.test(source ?? '')) type = 'pdf';
                else type = 'text';
            } else {
                ctx.status = 400; ctx.body = { error: `Unknown kind: ${kind}` }; return;
            }

            if (!content) { ctx.status = 400; ctx.body = { error: 'no content extracted' }; return; }

            const imported = nbImportSource(workDir, notebook, {
                title,
                content,
                source,
                type,
                summary: content.slice(0, 200).replace(/\n+/g, ' ').trim(),
            });

            // Fire-and-forget: generate guide in background
            const entry = nbGetSourceEntry(workDir, notebook, imported.id);
            if (entry) {
                generateAndSaveSourceGuide(workDir, notebook, entry, extractModel(body as Record<string, unknown>)).catch((err) => {
                    log.warn('notebook', `guide generation failed for ${imported.id}`, { error: err instanceof Error ? err.message : String(err) });
                });
            }

            ctx.body = imported;
        } catch (err: unknown) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

// ── POST /api/notebook/source-guide — On-demand guide generation ────────────

export function notebookGenerateGuide(router: Router): void {
    router.post('/api/notebook/source-guide', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
        if (!notebook || !sourceId) { ctx.status = 400; ctx.body = { error: 'notebook + sourceId required' }; return; }

        const entry = nbGetSourceEntry(workDir, notebook, sourceId);
        if (!entry) { ctx.status = 404; ctx.body = { error: 'Source not found' }; return; }

        try {
            ctx.body = await generateAndSaveSourceGuide(workDir, notebook, entry, extractModel(body));
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

// ── Source archive (soft-delete) & rename ────────────────────────────────────

export function notebookSourceActions(router: Router): void {
    // Soft-delete: set archived=true in frontmatter
    router.post('/api/notebook/source/archive', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
        if (!notebook || !sourceId) { ctx.status = 400; ctx.body = { error: 'notebook + sourceId required' }; return; }

        if (!nbArchiveSource(workDir, notebook, sourceId)) {
            ctx.status = 404; ctx.body = { error: 'Source not found' }; return;
        }
        ctx.body = { ok: true };
    });

    // Rename: update title in frontmatter
    router.post('/api/notebook/source/rename', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!notebook || !sourceId || !title) { ctx.status = 400; ctx.body = { error: 'notebook + sourceId + title required' }; return; }

        const updated = nbRenameSource(workDir, notebook, sourceId, title);
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Source not found' }; return; }
        ctx.body = updated;
    });
}
