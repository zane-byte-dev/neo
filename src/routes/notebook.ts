/**
 * src/routes/notebook.ts — Core notebook CRUD, config, and notes.
 *
 * Source management  → notebook-source.ts
 * AI generation      → notebook-studio.ts
 * Notebook chat      → unified via /api/chat (see routes/chat.ts)
 *
 * Re-exports from sibling modules so tests and callers can import
 * everything from one place.
 */

export {
    notebookImportSource,
    notebookGenerateGuide,
    notebookSourceActions,
} from './notebook-source.js';
export {
    notebookOverview,
    notebookGenerateArtifact,
    notebookDeleteArtifact,
} from './notebook-studio.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type Router from '@koa/router';
import {
    nbListNotebooks,
    nbListNotebooksProper,
    nbList,
    nbSearch,
    nbGet,
    nbCreate,
    nbUpdate,
    nbGetConfig,
    nbSetConfig,
    nbListNotes,
    nbSaveNote,
    nbDeleteNote,
    nbListAnnotations,
    nbSaveAnnotation,
    nbUpdateAnnotation,
    nbDeleteAnnotation,
    nbConvertNoteToSource,
    nbGetSourceEntry,
    nbListSources,
    nbRenameNotebook,
    parseFrontmatter,
} from '../services/notebook-service.js';

const execFileAsync = promisify(execFile);
import { generateAndSaveSourceGuide } from '../services/notebook-ai.js';
import { calcUser } from '../services/user-service.js';
import { trashArticle, trashNotebook } from '../services/trash-service.js';

const MAX_ANNOTATION_CONTEXT_TEXT = 200;

// ── GET /api/notebook — Read-only actions ───────────────────────────────────

export function notebookGet(router: Router): void {
    router.get('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
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
            // ── Config ────────────────────────────────────────────────────
            case 'config': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbGetConfig(workDir, nb, stateDir);
                break;
            }
            // ── Notes ─────────────────────────────────────────────────────
            case 'notes': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                ctx.body = nbListNotes(workDir, nb, stateDir);
                break;
            }
            case 'annotations': {
                const nb = q.notebook?.trim();
                const articleId = q.articleId?.trim();
                if (!nb || !articleId) { ctx.status = 400; ctx.body = { error: 'notebook + articleId required' }; return; }
                if (!nbGet(workDir, articleId)) { ctx.status = 404; ctx.body = { error: 'Article not found' }; return; }
                ctx.body = nbListAnnotations(workDir, nb, articleId, stateDir);
                break;
            }
            // ── Version history (git log) ──────────────────────────────────
            case 'history': {
                const id = q.id?.trim();
                if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
                const filePath = join(workDir, id);
                if (!filePath.startsWith(workDir + '/')) { ctx.status = 400; ctx.body = { error: 'Invalid id' }; return; }
                try {
                    const { stdout } = await execFileAsync(
                        'git',
                        ['-C', workDir, 'log', '--pretty=format:%H\t%aI\t%an\t%s', '--', id],
                        { encoding: 'utf8' },
                    );
                    const commits = stdout.trim().split('\n').filter(Boolean).map((line) => {
                        const [hash, date, author, ...msgParts] = line.split('\t');
                        return { hash, date, author, message: msgParts.join('\t') };
                    });
                    ctx.body = commits;
                } catch {
                    ctx.body = [];
                }
                break;
            }
            // ── Article content at a specific commit ───────────────────────
            case 'history-content': {
                const id = q.id?.trim();
                const commit = q.commit?.trim();
                if (!id || !commit) { ctx.status = 400; ctx.body = { error: 'id and commit required' }; return; }
                const filePath = join(workDir, id);
                if (!filePath.startsWith(workDir + '/')) { ctx.status = 400; ctx.body = { error: 'Invalid id' }; return; }
                // Allow only hex commit hashes (full or abbreviated)
                if (!/^[0-9a-f]{7,40}$/i.test(commit)) { ctx.status = 400; ctx.body = { error: 'Invalid commit hash' }; return; }
                try {
                    const { stdout } = await execFileAsync(
                        'git',
                        ['-C', workDir, 'show', `${commit}:${id}`],
                        { encoding: 'utf8' },
                    );
                    const { meta, body } = parseFrontmatter(stdout);
                    ctx.body = { content: body, title: meta.title ?? '', date: meta.date ?? null, author: meta.author ?? null };
                } catch {
                    ctx.status = 404;
                    ctx.body = { error: 'Not found at this commit' };
                }
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
        const { workDir, stateDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const id = q.id?.trim();
        if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
        const entry = nbGet(workDir, id);
        if (!entry) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        const item = await trashArticle(workDir, stateDir, id, entry.title);
        if (!item) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true, trashId: item.id };
    });
}

// ── Config ──────────────────────────────────────────────────────────────────

export function notebookConfig(router: Router): void {
    router.patch('/api/notebook/config', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        if (!notebook) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }

        const existing = nbGetConfig(workDir, notebook, stateDir);
        const merged = {
            ...existing,
            ...(typeof body.emoji === 'string' ? { emoji: body.emoji } : {}),
            ...(typeof body.description === 'string' ? { description: body.description } : {}),
            ...(typeof body.chatStyle === 'string' ? { chatStyle: body.chatStyle as 'default' | 'study-guide' | 'custom' } : {}),
            ...(typeof body.customStyle === 'string' ? { customStyle: body.customStyle } : {}),
            ...(typeof body.answerLength === 'string' ? { answerLength: body.answerLength as 'short' | 'default' | 'long' } : {}),
            ...(typeof body.citationMode === 'string' && ['strict', 'mixed'].includes(body.citationMode as string) ? { citationMode: body.citationMode as 'strict' | 'mixed' } : {}),
        };
        nbSetConfig(workDir, notebook, merged, stateDir);
        ctx.body = merged;
    });
}

// ── Notes ───────────────────────────────────────────────────────────────────

export function notebookNoteSave(router: Router): void {
    router.post('/api/notebook/note', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const content = typeof body.content === 'string' ? body.content : '';
        if (!notebook || !title) { ctx.status = 400; ctx.body = { error: 'notebook + title required' }; return; }

        const id = typeof body.id === 'string' ? body.id : undefined;
        const source = typeof body.source === 'string' ? body.source as 'user' | 'ai-chat' | 'ai-quick-action' : 'user';

        ctx.body = nbSaveNote(workDir, notebook, { id, title, content, source }, stateDir);
    });
}

export function notebookNoteDelete(router: Router): void {
    router.delete('/api/notebook/note', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const notebook = q.notebook?.trim();
        const id = q.id?.trim();
        if (!notebook || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }
        if (!nbDeleteNote(workDir, notebook, id, stateDir)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── Article annotations ─────────────────────────────────────────────────────

function isAnnotationKind(value: unknown): value is 'highlight' | 'paragraph' {
    return value === 'highlight' || value === 'paragraph';
}

function isAnnotationStatus(value: unknown): value is 'open' | 'resolved' {
    return value === 'open' || value === 'resolved';
}

function truncateContextText(value: unknown): string | undefined {
    return typeof value === 'string' ? value.slice(0, MAX_ANNOTATION_CONTEXT_TEXT) : undefined;
}

function parseAnchor(value: unknown) {
    if (!value || typeof value !== 'object') return {};
    const raw = value as Record<string, unknown>;
    const beforeText = truncateContextText(raw.beforeText);
    const afterText = truncateContextText(raw.afterText);
    return {
        ...(typeof raw.paragraphId === 'string' ? { paragraphId: raw.paragraphId } : {}),
        ...(typeof raw.startOffset === 'number' && Number.isFinite(raw.startOffset) ? { startOffset: raw.startOffset } : {}),
        ...(typeof raw.endOffset === 'number' && Number.isFinite(raw.endOffset) ? { endOffset: raw.endOffset } : {}),
        ...(beforeText !== undefined ? { beforeText } : {}),
        ...(afterText !== undefined ? { afterText } : {}),
    };
}

export function notebookAnnotationSave(router: Router): void {
    router.post('/api/notebook/annotation', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const articleId = typeof body.articleId === 'string' ? body.articleId.trim() : '';
        const quote = typeof body.quote === 'string' ? body.quote.trim() : '';
        const annotationBody = typeof body.body === 'string' ? body.body.trim() : '';
        if (!notebook || !articleId || !quote || !annotationBody) {
            ctx.status = 400; ctx.body = { error: 'notebook + articleId + quote + body required' }; return;
        }
        if (!isAnnotationKind(body.kind)) { ctx.status = 400; ctx.body = { error: 'invalid annotation kind' }; return; }
        if (body.status !== undefined && !isAnnotationStatus(body.status)) { ctx.status = 400; ctx.body = { error: 'invalid annotation status' }; return; }
        const article = nbGet(workDir, articleId);
        if (!article || article.notebook !== notebook) { ctx.status = 404; ctx.body = { error: 'Article not found' }; return; }

        ctx.body = nbSaveAnnotation(workDir, notebook, {
            id: typeof body.id === 'string' ? body.id : undefined,
            articleId,
            kind: body.kind,
            quote,
            anchor: parseAnchor(body.anchor),
            body: annotationBody,
            status: body.status,
            author: typeof body.author === 'string' && body.author.trim() ? body.author.trim() : null,
        }, stateDir);
    });
}

export function notebookAnnotationUpdate(router: Router): void {
    router.patch('/api/notebook/annotation', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const articleId = typeof body.articleId === 'string' ? body.articleId.trim() : '';
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!notebook || !articleId || !id) { ctx.status = 400; ctx.body = { error: 'notebook + articleId + id required' }; return; }
        if (body.status !== undefined && !isAnnotationStatus(body.status)) { ctx.status = 400; ctx.body = { error: 'invalid annotation status' }; return; }
        if (!nbGet(workDir, articleId)) { ctx.status = 404; ctx.body = { error: 'Article not found' }; return; }

        const updated = nbUpdateAnnotation(workDir, notebook, articleId, id, {
            ...(typeof body.body === 'string' ? { body: body.body.trim() } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
        }, stateDir);
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Annotation not found' }; return; }
        ctx.body = updated;
    });
}

export function notebookAnnotationDelete(router: Router): void {
    router.delete('/api/notebook/annotation', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const notebook = q.notebook?.trim();
        const articleId = q.articleId?.trim();
        const id = q.id?.trim();
        if (!notebook || !articleId || !id) { ctx.status = 400; ctx.body = { error: 'notebook + articleId + id required' }; return; }
        if (!nbDeleteAnnotation(workDir, notebook, articleId, id, stateDir)) { ctx.status = 404; ctx.body = { error: 'Annotation not found' }; return; }
        ctx.body = { ok: true };
    });
}

export function notebookNoteConvertToSource(router: Router): void {
    router.post('/api/notebook/note/convert', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!notebook || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }

        const imported = nbConvertNoteToSource(workDir, notebook, id, stateDir);
        if (!imported) { ctx.status = 404; ctx.body = { error: 'Note not found' }; return; }

        const entry = nbGetSourceEntry(workDir, notebook, imported.id);
        if (entry) {
            generateAndSaveSourceGuide(workDir, notebook, entry, undefined, stateDir).catch(() => { /* ignore */ });
        }
        ctx.body = imported;
    });
}

// ── DELETE /api/notebook/folder — Delete an entire notebook ─────────────────

export function notebookFolderDelete(router: Router): void {
    router.delete('/api/notebook/folder', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const name = q.name?.trim();
        if (!name) { ctx.status = 400; ctx.body = { error: 'name required' }; return; }
        const item = await trashNotebook(workDir, stateDir, name);
        if (!item) {
            ctx.status = 404; ctx.body = { error: 'Notebook not found or invalid name' }; return;
        }
        ctx.body = { ok: true, trashId: item.id };
    });
}

// ── PATCH /api/notebook/folder — Rename a notebook ──────────────────────────

export function notebookFolderRename(router: Router): void {
    router.patch('/api/notebook/folder', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const newName = typeof body.newName === 'string' ? body.newName.trim() : '';
        if (!name || !newName) { ctx.status = 400; ctx.body = { error: 'name + newName required' }; return; }
        if (!nbRenameNotebook(workDir, stateDir, name, newName)) {
            ctx.status = 409; ctx.body = { error: 'Rename failed: source not found or target already exists' }; return;
        }
        ctx.body = { ok: true, name: newName };
    });
}
