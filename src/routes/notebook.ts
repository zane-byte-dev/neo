import type Router from '@koa/router';
import {
    nbListNotebooks,
    nbListNotebooksProper,
    nbList,
    nbSearch,
    nbGet,
    nbCreate,
    nbUpdate,
    nbDelete,
    nbListSources,
    nbImportSource,
    nbGetSourceEntry,
    nbGetSourceGuide,
    nbGetConfig,
    nbSetConfig,
    nbListNotes,
    nbSaveNote,
    nbDeleteNote,
    nbConvertNoteToSource,
    nbListArtifacts,
    nbGetArtifact,
    nbDeleteArtifact,
    nbReadChatHistory,
    nbClearChatHistory,
    type ArtifactType,
} from '../services/notebook-service.js';
import {
    generateAndSaveSourceGuide,
    generateNotebookOverview,
    generateMindMap,
    generateReport,
    generateAudioScript,
    runNoteQuickAction,
    type ReportType,
    type NoteQuickAction,
} from '../services/notebook-ai.js';
import { streamNotebookChat } from '../services/notebook-chat.js';
import { parseUrl, parseYouTube, isYouTubeUrl } from '../services/document-parser.js';
import { calcUser } from '../services/user-service.js';

// ── GET /api/notebook — Read-only actions ───────────────────────────────────

export function notebookGet(router: Router): void {
    router.get('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;

        switch (q.action) {
            case 'notebooks': {
                // New proper listing: only direct subfolders of /notebooks
                ctx.body = nbListNotebooksProper(workDir);
                break;
            }
            case 'notebooks-legacy': {
                ctx.body = nbListNotebooks(workDir);
                break;
            }
            case 'list': {
                const limit = Math.min(Number(q.limit) || 200, 500);
                ctx.body = nbList(workDir, {
                    notebook: q.notebook || undefined,
                    limit,
                });
                break;
            }
            case 'search': {
                const term = q.q?.trim() ?? '';
                if (!term) { ctx.body = []; return; }
                ctx.body = nbSearch(workDir, term, {
                    notebook: q.notebook || undefined,
                    limit: 50,
                });
                break;
            }
            case 'read': {
                const id = q.id?.trim();
                if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
                const row = nbGet(workDir, id);
                if (!row) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
                ctx.body = row;
                break;
            }
            // ── Sources ───────────────────────────────────────────────────
            case 'sources': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbListSources(workDir, nb);
                break;
            }
            case 'source': {
                const nb = q.notebook?.trim();
                const sid = q.sourceId?.trim();
                if (!nb || !sid) { ctx.status = 400; ctx.body = { error: 'notebook + sourceId required' }; return; }
                const entry = nbGetSourceEntry(workDir, nb, sid);
                if (!entry) { ctx.status = 404; ctx.body = { error: 'Source not found' }; return; }
                ctx.body = entry;
                break;
            }
            case 'source-guide': {
                const nb = q.notebook?.trim();
                const sid = q.sourceId?.trim();
                if (!nb || !sid) { ctx.status = 400; ctx.body = { error: 'notebook + sourceId required' }; return; }
                const guide = nbGetSourceGuide(workDir, nb, sid);
                if (!guide) { ctx.status = 404; ctx.body = { error: 'Guide not found' }; return; }
                ctx.body = guide;
                break;
            }
            // ── Config ────────────────────────────────────────────────────
            case 'config': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbGetConfig(workDir, nb);
                break;
            }
            // ── Notes ─────────────────────────────────────────────────────
            case 'notes': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbListNotes(workDir, nb);
                break;
            }
            // ── Artifacts ─────────────────────────────────────────────────
            case 'artifacts': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                const type = (q.type?.trim() || undefined) as ArtifactType | undefined;
                ctx.body = nbListArtifacts(workDir, nb, type);
                break;
            }
            case 'artifact': {
                const nb = q.notebook?.trim();
                const id = q.id?.trim();
                if (!nb || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }
                const a = nbGetArtifact(workDir, nb, id);
                if (!a) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
                ctx.body = a;
                break;
            }
            // ── Chat history ──────────────────────────────────────────────
            case 'chat-history': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbReadChatHistory(workDir, nb);
                break;
            }
            default:
                ctx.status = 400;
                ctx.body = { error: `Unknown action: ${q.action ?? '(none)'}` };
        }
    });
}

// ── POST /api/notebook — Create article (backward compat) ──────────────────

export function notebookCreate(router: Router): void {
    router.post('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) { ctx.status = 400; ctx.body = { error: 'title required' }; return; }

        const notebook = typeof body.notebook === 'string' && body.notebook.trim()
            ? body.notebook.trim()
            : 'personal';

        ctx.body = nbCreate(workDir, notebook, {
            title,
            author:  typeof body.author  === 'string' ? body.author  : null,
            date:    typeof body.date    === 'string' ? body.date    : null,
            source:  typeof body.source  === 'string' ? body.source  : null,
            summary: typeof body.summary === 'string' ? body.summary : null,
            tags:    typeof body.tags    === 'string' ? body.tags    : null,
            content: typeof body.content === 'string' ? body.content : null,
        });
    });
}

export function notebookUpdate(router: Router): void {
    router.patch('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const id = q.id?.trim();
        if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }

        const body = ctx.request.body as Record<string, unknown>;
        const updated = nbUpdate(workDir, id, {
            title:   body.title   !== undefined ? String(body.title)   : undefined,
            author:  body.author  !== undefined ? (body.author  === null ? null : String(body.author))  : undefined,
            date:    body.date    !== undefined ? (body.date    === null ? null : String(body.date))    : undefined,
            source:  body.source  !== undefined ? (body.source  === null ? null : String(body.source))  : undefined,
            summary: body.summary !== undefined ? (body.summary === null ? null : String(body.summary)) : undefined,
            tags:    body.tags    !== undefined ? (body.tags    === null ? null : String(body.tags))    : undefined,
            content: body.content !== undefined ? (body.content === null ? null : String(body.content)) : undefined,
        });
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = updated;
    });
}

export function notebookDelete(router: Router): void {
    router.delete('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const id = q.id?.trim();
        if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
        if (!nbDelete(workDir, id)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── Source import ───────────────────────────────────────────────────────────

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
                generateAndSaveSourceGuide(workDir, notebook, entry).catch((err) => {
                    console.warn(`[notebook] guide generation failed for ${imported.id}:`, err);
                });
            }

            ctx.body = imported;
        } catch (err: unknown) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

// ── Source guide generation (on demand) ─────────────────────────────────────

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
            ctx.body = await generateAndSaveSourceGuide(workDir, notebook, entry);
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

// ── Notebook overview ───────────────────────────────────────────────────────

export function notebookOverview(router: Router): void {
    router.post('/api/notebook/overview', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        if (!notebook) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }

        const sourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined;
        try {
            const overview = await generateNotebookOverview(workDir, notebook, sourceIds);
            ctx.body = { overview };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

// ── Config ──────────────────────────────────────────────────────────────────

export function notebookConfig(router: Router): void {
    router.patch('/api/notebook/config', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        if (!notebook) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }

        const existing = nbGetConfig(workDir, notebook);
        const merged = {
            ...existing,
            ...(typeof body.emoji === 'string' ? { emoji: body.emoji } : {}),
            ...(typeof body.description === 'string' ? { description: body.description } : {}),
            ...(typeof body.chatStyle === 'string' ? { chatStyle: body.chatStyle as 'default' | 'study-guide' | 'custom' } : {}),
            ...(typeof body.customStyle === 'string' ? { customStyle: body.customStyle } : {}),
            ...(typeof body.answerLength === 'string' ? { answerLength: body.answerLength as 'short' | 'default' | 'long' } : {}),
        };
        nbSetConfig(workDir, notebook, merged);
        ctx.body = merged;
    });
}

// ── Notes ───────────────────────────────────────────────────────────────────

export function notebookNoteSave(router: Router): void {
    router.post('/api/notebook/note', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const content = typeof body.content === 'string' ? body.content : '';
        if (!notebook || !title) { ctx.status = 400; ctx.body = { error: 'notebook + title required' }; return; }

        const id = typeof body.id === 'string' ? body.id : undefined;
        const source = typeof body.source === 'string' ? body.source as 'user' | 'ai-chat' | 'ai-quick-action' : 'user';

        ctx.body = nbSaveNote(workDir, notebook, { id, title, content, source });
    });
}

export function notebookNoteDelete(router: Router): void {
    router.delete('/api/notebook/note', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const notebook = q.notebook?.trim();
        const id = q.id?.trim();
        if (!notebook || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }
        if (!nbDeleteNote(workDir, notebook, id)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

export function notebookNoteConvertToSource(router: Router): void {
    router.post('/api/notebook/note/convert', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!notebook || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }

        const imported = nbConvertNoteToSource(workDir, notebook, id);
        if (!imported) { ctx.status = 404; ctx.body = { error: 'Note not found' }; return; }

        const entry = nbGetSourceEntry(workDir, notebook, imported.id);
        if (entry) {
            generateAndSaveSourceGuide(workDir, notebook, entry).catch(() => { /* ignore */ });
        }
        ctx.body = imported;
    });
}

export function notebookNoteQuickAction(router: Router): void {
    router.post('/api/notebook/note/quick-action', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const action = typeof body.action === 'string' ? body.action as NoteQuickAction : 'merge';
        const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
        if (!notebook || !ids.length) { ctx.status = 400; ctx.body = { error: 'notebook + ids required' }; return; }

        const allNotes = nbListNotes(workDir, notebook);
        const selected = allNotes.filter(n => ids.includes(n.id));
        if (!selected.length) { ctx.status = 404; ctx.body = { error: 'No matching notes' }; return; }

        try {
            const result = await runNoteQuickAction(action, selected.map(n => ({ title: n.title, content: n.content })));
            const saved = nbSaveNote(workDir, notebook, {
                title: `${action} · ${new Date().toLocaleString('zh-CN')}`,
                content: result,
                source: 'ai-quick-action',
            });
            ctx.body = saved;
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

// ── Artifacts (mindmap / report / audio) ────────────────────────────────────

export function notebookGenerateArtifact(router: Router): void {
    router.post('/api/notebook/artifact', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const type = typeof body.type === 'string' ? body.type : '';
        if (!notebook || !type) { ctx.status = 400; ctx.body = { error: 'notebook + type required' }; return; }

        const sourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined;

        try {
            let artifact;
            if (type === 'mindmap') {
                const topic = typeof body.topic === 'string' ? body.topic : undefined;
                artifact = await generateMindMap(workDir, notebook, sourceIds, topic);
            } else if (type === 'report') {
                const subtype = (typeof body.subtype === 'string' ? body.subtype : 'briefing') as ReportType;
                const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt : undefined;
                const title = typeof body.title === 'string' ? body.title : undefined;
                artifact = await generateReport(workDir, notebook, subtype, { sourceIds, customPrompt, title });
            } else if (type === 'audio') {
                artifact = await generateAudioScript(workDir, notebook, sourceIds);
            } else {
                ctx.status = 400; ctx.body = { error: `Unknown artifact type: ${type}` }; return;
            }
            ctx.body = artifact;
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

export function notebookDeleteArtifact(router: Router): void {
    router.delete('/api/notebook/artifact', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const notebook = q.notebook?.trim();
        const id = q.id?.trim();
        if (!notebook || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }
        if (!nbDeleteArtifact(workDir, notebook, id)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── Source-grounded chat (SSE) ──────────────────────────────────────────────

export function notebookChat(router: Router): void {
    router.post('/api/notebook/chat', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const message = typeof body.message === 'string' ? body.message : '';
        if (!notebook || !message.trim()) { ctx.status = 400; ctx.body = { error: 'notebook + message required' }; return; }

        const selectedSourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined;

        ctx.set('Content-Type', 'text/event-stream');
        ctx.set('Cache-Control', 'no-cache');
        ctx.set('Connection', 'keep-alive');
        ctx.status = 200;
        ctx.respond = false;

        const res = ctx.res;
        const send = (evt: unknown) => {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
        };

        const controller = new AbortController();
        ctx.req.on('close', () => controller.abort());

        try {
            await streamNotebookChat(workDir, notebook, message, selectedSourceIds, send, controller.signal);
        } catch (err) {
            send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        } finally {
            res.end();
        }
    });
}

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
