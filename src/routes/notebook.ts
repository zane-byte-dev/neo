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
    nbGetConfig,
    nbSetConfig,
    nbListNotes,
    nbSaveNote,
    nbDeleteNote,
    nbConvertNoteToSource,
    nbGetSourceEntry,
    nbListSources,
    nbDeleteNotebook,
    nbRenameNotebook,
} from '../services/notebook-service.js';
import { generateAndSaveSourceGuide } from '../services/notebook-ai.js';
import { calcUser } from '../services/user-service.js';
import { getMonthlyUsage } from '../utils/token-tracker.js';

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
            // ── Token usage ───────────────────────────────────────────────
            case 'token-usage': {
                const month = q.month?.trim() || undefined;
                ctx.body = await getMonthlyUsage(month);
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
        if (!nbDeleteNotebook(workDir, stateDir, name)) {
            ctx.status = 404; ctx.body = { error: 'Notebook not found or invalid name' }; return;
        }
        ctx.body = { ok: true };
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
