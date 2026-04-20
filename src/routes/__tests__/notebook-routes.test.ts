import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';
import {
    notebookGet, notebookCreate, notebookUpdate, notebookDelete,
    notebookImportSource, notebookGenerateGuide, notebookSourceActions,
    notebookOverview, notebookConfig, notebookNoteSave, notebookNoteDelete,
    notebookGenerateArtifact, notebookDeleteArtifact, notebookChat,
    notebookClearChat,
} from '../notebook.js';

// Mock user-service to return tmpdir workDir
let workDir: string;

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn(async () => ({ workDir })),
}));

// Mock AI functions to avoid real LLM calls
vi.mock('../../services/notebook-ai.js', () => ({
    generateAndSaveSourceGuide: vi.fn(async () => ({
        sourceId: 'test',
        summary: 'Mocked summary',
        keyTopics: ['topic1'],
        suggestedQuestions: ['question1'],
        generatedAt: Date.now(),
    })),
    generateNotebookOverview: vi.fn(async () => 'Mocked overview'),
    generateMindMap: vi.fn(async () => ({
        id: 'mm_1',
        type: 'mindmap',
        title: '思维导图',
        data: { markdown: '# Root' },
        createdAt: Date.now(),
    })),
    generateReport: vi.fn(async () => ({
        id: 'rpt_1',
        type: 'report',
        subtype: 'faq',
        title: 'FAQ',
        data: { markdown: '### Q1\nA1' },
        createdAt: Date.now(),
    })),
    generateAudioScript: vi.fn(async () => ({
        id: 'aud_1',
        type: 'audio',
        title: '音频',
        data: { segments: [{ speaker: 'A', text: 'Hi' }] },
        createdAt: Date.now(),
    })),
    runNoteQuickAction: vi.fn(async () => 'Quick action result'),
}));

// Mock notebook-chat
vi.mock('../../services/notebook-chat.js', () => ({
    streamNotebookChat: vi.fn(async (_w: string, _n: string, _m: string, _s: string[] | undefined, onEvent: (e: any) => void) => {
        onEvent({ type: 'meta', sources: [] });
        onEvent({ type: 'text', text: 'Mocked response' });
        onEvent({ type: 'citations', citations: [] });
        onEvent({ type: 'done' });
        return { id: 'msg_1', role: 'assistant', content: 'Mocked response', timestamp: Date.now() };
    }),
}));

const TEST_USER = 'test-user-123';
let cookie: string;

function buildApp() {
    const { app, router, mount } = createTestApp();
    notebookGet(router);
    notebookCreate(router);
    notebookUpdate(router);
    notebookDelete(router);
    notebookImportSource(router);
    notebookGenerateGuide(router);
    notebookSourceActions(router);
    notebookOverview(router);
    notebookConfig(router);
    notebookNoteSave(router);
    notebookNoteDelete(router);
    notebookGenerateArtifact(router);
    notebookDeleteArtifact(router);
    notebookClearChat(router);
    mount();
    return app;
}

beforeEach(async () => {
    workDir = join(tmpdir(), `neo-test-route-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(workDir, { recursive: true });
    cookie = signedCookie(TEST_USER);
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('GET /api/notebook', () => {
    it('lists notebooks', async () => {
        const app = buildApp();
        // Create a notebook entry so the directory exists
        await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'Test', notebook: 'my-nb', content: 'body' });

        const res = await request(app.callback())
            .get('/api/notebook?action=notebooks')
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('lists entries in a notebook', async () => {
        const app = buildApp();
        await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'Entry1', notebook: 'list-nb', content: 'body1' });

        const res = await request(app.callback())
            .get('/api/notebook?action=list&notebook=list-nb')
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('searches entries', async () => {
        const app = buildApp();
        await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'Searchable Item', notebook: 'search-nb', content: 'unique keyword zebra' });

        const res = await request(app.callback())
            .get('/api/notebook?action=search&q=zebra&notebook=search-nb')
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
    });

    it('reads a specific entry', async () => {
        const app = buildApp();
        const createRes = await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'Read Me', notebook: 'read-nb', content: 'hello' });

        const id = createRes.body.id;
        const res = await request(app.callback())
            .get(`/api/notebook?action=read&id=${encodeURIComponent(id)}`)
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Read Me');
    });

    it('returns 400 for unknown action', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/notebook?action=foobar')
            .set('Cookie', cookie);

        expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/notebook?action=notebooks');

        expect(res.status).toBe(401);
    });
});

describe('POST /api/notebook (create)', () => {
    it('creates entry with title and content', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'New Entry', content: 'Some content', notebook: 'create-nb' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('New Entry');
        expect(res.body.id).toBeDefined();
    });

    it('returns 400 without title', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ content: 'No title' });

        expect(res.status).toBe(400);
    });
});

describe('PATCH /api/notebook (update)', () => {
    it('updates entry fields', async () => {
        const app = buildApp();
        const createRes = await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'Original', content: 'orig', notebook: 'update-nb' });

        const res = await request(app.callback())
            .patch(`/api/notebook?id=${encodeURIComponent(createRes.body.id)}`)
            .set('Cookie', cookie)
            .send({ title: 'Updated', content: 'new body' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Updated');
    });
});

describe('DELETE /api/notebook', () => {
    it('deletes an existing entry', async () => {
        const app = buildApp();
        const createRes = await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'To Delete', content: 'bye', notebook: 'del-nb' });

        const res = await request(app.callback())
            .delete(`/api/notebook?id=${encodeURIComponent(createRes.body.id)}`)
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});

describe('POST /api/notebook/import', () => {
    it('imports text source', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie)
            .send({ notebook: 'imp-nb', kind: 'text', title: 'Text Source', content: 'Some text content here' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Text Source');
        expect(res.body.id).toBeDefined();
    });

    it('returns 400 for empty content', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie)
            .send({ notebook: 'imp-nb', kind: 'text', title: 'Empty', content: '' });

        expect(res.status).toBe(400);
    });
});

describe('POST /api/notebook/source-guide', () => {
    it('generates source guide', async () => {
        const app = buildApp();
        // First import a source
        const impRes = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie)
            .send({ notebook: 'guide-nb', kind: 'text', title: 'Guide Src', content: 'Content for guide' });

        const res = await request(app.callback())
            .post('/api/notebook/source-guide')
            .set('Cookie', cookie)
            .send({ notebook: 'guide-nb', sourceId: impRes.body.id });

        expect(res.status).toBe(200);
        expect(res.body.summary).toBeDefined();
    });
});

describe('POST /api/notebook/source/archive', () => {
    it('archives a source', async () => {
        const app = buildApp();
        const impRes = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie)
            .send({ notebook: 'arch-nb', kind: 'text', title: 'Archive Me', content: 'content' });

        const res = await request(app.callback())
            .post('/api/notebook/source/archive')
            .set('Cookie', cookie)
            .send({ notebook: 'arch-nb', sourceId: impRes.body.id });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        // Verify it's gone from sources list
        const listRes = await request(app.callback())
            .get('/api/notebook?action=sources&notebook=arch-nb')
            .set('Cookie', cookie);
        expect(listRes.body.find((s: any) => s.id === impRes.body.id)).toBeUndefined();
    });
});

describe('POST /api/notebook/source/rename', () => {
    it('renames a source', async () => {
        const app = buildApp();
        const impRes = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie)
            .send({ notebook: 'ren-nb', kind: 'text', title: 'Old Name', content: 'content' });

        const res = await request(app.callback())
            .post('/api/notebook/source/rename')
            .set('Cookie', cookie)
            .send({ notebook: 'ren-nb', sourceId: impRes.body.id, title: 'New Name' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('New Name');
    });
});

describe('POST /api/notebook/overview', () => {
    it('generates notebook overview', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook/overview')
            .set('Cookie', cookie)
            .send({ notebook: 'ov-nb' });

        expect(res.status).toBe(200);
        expect(res.body.overview).toBeDefined();
    });
});

describe('PATCH /api/notebook/config', () => {
    it('updates notebook config', async () => {
        const app = buildApp();
        // Create notebook first
        await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'Cfg', content: 'body', notebook: 'cfg-nb' });

        const res = await request(app.callback())
            .patch('/api/notebook/config')
            .set('Cookie', cookie)
            .send({ notebook: 'cfg-nb', citationMode: 'mixed', answerLength: 'long' });

        expect(res.status).toBe(200);
        expect(res.body.citationMode).toBe('mixed');
        expect(res.body.answerLength).toBe('long');
    });
});

describe('POST/DELETE /api/notebook/note', () => {
    it('creates and deletes a note', async () => {
        const app = buildApp();
        // Need notebook dir
        await request(app.callback())
            .post('/api/notebook')
            .set('Cookie', cookie)
            .send({ title: 'NB Entry', content: 'body', notebook: 'note-nb' });

        const createRes = await request(app.callback())
            .post('/api/notebook/note')
            .set('Cookie', cookie)
            .send({ notebook: 'note-nb', title: 'My Note', content: 'Note content', source: 'user' });

        expect(createRes.status).toBe(200);
        expect(createRes.body.title).toBe('My Note');

        const delRes = await request(app.callback())
            .delete(`/api/notebook/note?notebook=note-nb&id=${createRes.body.id}`)
            .set('Cookie', cookie);

        expect(delRes.status).toBe(200);
    });
});

describe('POST /api/notebook/artifact', () => {
    it('generates mindmap artifact', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie)
            .send({ notebook: 'art-nb', type: 'mindmap', topic: 'AI' });

        expect(res.status).toBe(200);
        expect(res.body.type).toBe('mindmap');
    });

    it('returns 400 for unknown artifact type', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie)
            .send({ notebook: 'art-nb', type: 'unknown' });

        expect(res.status).toBe(400);
    });
});
