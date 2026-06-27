import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: vi.fn().mockResolvedValue({ workDir: '/tmp/test-nb', stateDir: '/tmp/test-nb' }),
}));

vi.mock('@neo/agent/services/notebook-service.js', () => ({
    nbListNotebooks: vi.fn().mockReturnValue(['personal', 'work']),
    nbListNotebooksProper: vi.fn().mockReturnValue(['personal', 'work']),
    nbList: vi.fn().mockReturnValue([
        { id: 'personal/note1.md', notebook: 'personal', filename: 'note1.md', title: 'Note 1', author: null, date: null, source: null, summary: null, tags: null },
    ]),
    nbSearch: vi.fn().mockReturnValue([
        { id: 'personal/note1.md', notebook: 'personal', filename: 'note1.md', title: 'Note 1', author: null, date: null, source: null, summary: null, tags: null, snippet: '...match...' },
    ]),
    nbGet: vi.fn().mockReturnValue({
        id: 'personal/note1.md', notebook: 'personal', filename: 'note1.md',
        title: 'Note 1', content: 'Hello world', author: null, date: null, source: null, summary: null, tags: null,
    }),
    nbCreate: vi.fn().mockReturnValue({
        id: 'personal/new-note.md', notebook: 'personal', filename: 'new-note.md', title: 'New Note',
        author: null, date: null, source: null, summary: null, tags: null,
    }),
    nbUpdate: vi.fn().mockReturnValue({
        id: 'personal/note1.md', notebook: 'personal', filename: 'note1.md', title: 'Updated',
        author: null, date: null, source: null, summary: null, tags: null,
    }),
    nbDelete: vi.fn().mockReturnValue(true),
    // New NotebookLM primitives (mocked as no-ops / empty results; not directly tested here)
    nbListSources: vi.fn().mockReturnValue([]),
    nbImportSource: vi.fn(),
    nbGetSourceEntry: vi.fn().mockReturnValue(null),
    nbGetSourceGuide: vi.fn().mockReturnValue(null),
    nbSaveSourceGuide: vi.fn(),
    nbGetConfig: vi.fn().mockReturnValue({}),
    nbSetConfig: vi.fn(),
    nbListNotes: vi.fn().mockReturnValue([]),
    nbSaveNote: vi.fn(),
    nbDeleteNote: vi.fn().mockReturnValue(true),
    nbConvertNoteToSource: vi.fn().mockReturnValue(null),
    nbListArtifacts: vi.fn().mockReturnValue([]),
    nbGetArtifact: vi.fn().mockReturnValue(null),
    nbSaveArtifact: vi.fn(),
    nbDeleteArtifact: vi.fn().mockReturnValue(true),
    nbReadChatHistory: vi.fn().mockReturnValue([]),
    nbAppendChatMessage: vi.fn(),
    nbClearChatHistory: vi.fn(),
    sourceIdFromEntryId: vi.fn((id: string) => id),
}));

vi.mock('../../services/trash-service.js', () => ({
    trashArticle: vi.fn().mockResolvedValue({ id: 'trash_1', type: 'article', title: 'Note 1', deletedAt: Date.now() }),
    trashNotebook: vi.fn(),
}));

// Mock AI/chat/parser modules so the route file imports succeed (they're not exercised here)
vi.mock('@neo/agent/services/notebook-ai.js', () => ({
    generateAndSaveSourceGuide: vi.fn(),
    generateNotebookOverview: vi.fn(),
    generateMindMap: vi.fn(),
    generateReport: vi.fn(),
    generateAudioScript: vi.fn(),
    runNoteQuickAction: vi.fn(),
}));
vi.mock('../../services/document-parser.js', () => ({
    parseUrl: vi.fn(),
    parseYouTube: vi.fn(),
    isYouTubeUrl: vi.fn().mockReturnValue(false),
}));

import { notebookGet, notebookCreate, notebookUpdate, notebookDelete } from '../notebook.js';
import { nbGet } from '@neo/agent/services/notebook-service.js';
import { trashArticle } from '../../services/trash-service.js';

const cookie = signedCookie('testuser');

function buildApp() {
    const { app, router, mount } = createTestApp();
    notebookGet(router);
    notebookCreate(router);
    notebookUpdate(router);
    notebookDelete(router);
    mount();
    return app;
}

describe('Notebook routes', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('GET /api/notebook?action=list returns notes', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/notebook')
            .query({ action: 'list' })
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/notebook?action=read&id=... returns a single note', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/notebook')
            .query({ action: 'read', id: 'personal/note1.md' })
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Note 1');
        expect(res.body.content).toBe('Hello world');
    });

    it('GET /api/notebook?action=read returns 404 for missing note', async () => {
        vi.mocked(nbGet).mockReturnValueOnce(undefined as any);
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/notebook')
            .query({ action: 'read', id: 'nonexistent.md' })
            .set('Cookie', cookie);
        expect(res.status).toBe(404);
    });

    it('POST /api/notebook creates a note', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'New Note', content: 'body text' });
        expect(res.status).toBe(200);
        expect(res.body.title).toBe('New Note');
    });

    it('POST /api/notebook returns 400 without title', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ content: 'no title' });
        expect(res.status).toBe(400);
    });

    it('PATCH /api/notebook updates a note', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .patch('/api/notebook')
            .query({ id: 'personal/note1.md' })
            .set('Cookie', cookie)
            .send({ title: 'Updated' });
        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Updated');
    });

    it('DELETE /api/notebook deletes a note', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .delete('/api/notebook')
            .query({ id: 'personal/note1.md' })
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.trashId).toBe('trash_1');
        expect(vi.mocked(trashArticle)).toHaveBeenCalledWith('/tmp/test-nb', '/tmp/test-nb', 'personal/note1.md', 'Note 1');
    });

    it('DELETE /api/notebook returns 404 for missing note', async () => {
        vi.mocked(nbGet).mockReturnValueOnce(undefined as any);
        const app = buildApp();
        const res = await request(app.callback())
            .delete('/api/notebook')
            .query({ id: 'nonexistent.md' })
            .set('Cookie', cookie);
        expect(res.status).toBe(404);
    });

    it('GET /api/notebook?action=search&q=... searches notes', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/notebook')
            .query({ action: 'search', q: 'match' })
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0].snippet).toBeDefined();
    });

    it('GET /api/notebook?action=notebooks lists notebook directories', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/notebook')
            .query({ action: 'notebooks' })
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(['personal', 'work']);
    });
});
