/**
 * Tests for notebook-source / notebook-studio route modules
 * — covers GET branches and validation 400/404 paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const {
    calcUserMock,
    nbListSourcesMock,
    nbListSourcesWithGuidesMock,
    nbGetSourceEntryMock,
    nbGetSourceGuideMock,
    nbImportSourceMock,
    nbArchiveSourceMock,
    nbRenameSourceMock,
    nbListArtifactsMock,
    nbGetArtifactMock,
    nbDeleteArtifactMock,
} = vi.hoisted(() => ({
    calcUserMock: vi.fn(),
    nbListSourcesMock: vi.fn(),
    nbListSourcesWithGuidesMock: vi.fn(),
    nbGetSourceEntryMock: vi.fn(),
    nbGetSourceGuideMock: vi.fn(),
    nbImportSourceMock: vi.fn(),
    nbArchiveSourceMock: vi.fn(),
    nbRenameSourceMock: vi.fn(),
    nbListArtifactsMock: vi.fn(),
    nbGetArtifactMock: vi.fn(),
    nbDeleteArtifactMock: vi.fn(),
}));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: calcUserMock,
}));

vi.mock('@neo/agent/services/notebook-service.js', () => ({
    nbListSources: nbListSourcesMock,
    nbListSourcesWithGuides: nbListSourcesWithGuidesMock,
    nbGetSourceEntry: nbGetSourceEntryMock,
    nbGetSourceGuide: nbGetSourceGuideMock,
    nbImportSource: nbImportSourceMock,
    nbArchiveSource: nbArchiveSourceMock,
    nbRenameSource: nbRenameSourceMock,
    nbListArtifacts: nbListArtifactsMock,
    nbGetArtifact: nbGetArtifactMock,
    nbDeleteArtifact: nbDeleteArtifactMock,
    nbListNotes: vi.fn(() => []),
    nbSaveNote: vi.fn((_w, _n, x) => ({ id: 'n1', ...x })),
}));

vi.mock('@neo/agent/services/notebook-ai.js', () => ({
    generateAndSaveSourceGuide: vi.fn(async () => ({ summary: 's' })),
    generateNotebookOverview: vi.fn(async () => 'overview'),
    generateMindMap: vi.fn(async () => ({ id: 'm1', type: 'mindmap' })),
    generateReport: vi.fn(async () => ({ id: 'r1', type: 'report' })),
    generateAudioScript: vi.fn(async () => ({ id: 'a1', type: 'audio' })),
    runNoteQuickAction: vi.fn(async () => 'result'),
}));

let workDir: string;
const cookie = () => signedCookie('u1');

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'nb-routes-'));
    calcUserMock.mockResolvedValue({ workDir });
    [nbListSourcesMock, nbListSourcesWithGuidesMock, nbGetSourceEntryMock, nbGetSourceGuideMock,
     nbImportSourceMock, nbArchiveSourceMock, nbRenameSourceMock,
     nbListArtifactsMock, nbGetArtifactMock, nbDeleteArtifactMock].forEach((m) => m.mockReset());
});

afterEach(() => rmSync(workDir, { recursive: true, force: true }));

describe('GET /api/notebook/source', () => {
    it('lists sources for valid notebook', async () => {
        const { notebookSourceGet } = await import('../notebook-source.js');
        nbListSourcesMock.mockReturnValue([{ id: 's1', title: 'A' }]);
        const { app, router, mount } = createTestApp();
        notebookSourceGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/source?action=list&notebook=nb1')
            .set('Cookie', cookie());
        expect(res.status).toBe(200);
        expect(res.body[0].id).toBe('s1');
    });

    it('400 when action=list without notebook', async () => {
        const { notebookSourceGet } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/source?action=list')
            .set('Cookie', cookie());
        expect(res.status).toBe(400);
    });

    it('list-with-guides path works', async () => {
        const { notebookSourceGet } = await import('../notebook-source.js');
        nbListSourcesWithGuidesMock.mockReturnValue([]);
        const { app, router, mount } = createTestApp();
        notebookSourceGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/source?action=list-with-guides&notebook=nb1')
            .set('Cookie', cookie());
        expect(res.status).toBe(200);
    });

    it('read returns 404 when source missing', async () => {
        const { notebookSourceGet } = await import('../notebook-source.js');
        nbGetSourceEntryMock.mockReturnValue(null);
        const { app, router, mount } = createTestApp();
        notebookSourceGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/source?action=read&notebook=nb1&sourceId=s1')
            .set('Cookie', cookie());
        expect(res.status).toBe(404);
    });

    it('guide returns null when not found', async () => {
        const { notebookSourceGet } = await import('../notebook-source.js');
        nbGetSourceGuideMock.mockReturnValue(undefined);
        const { app, router, mount } = createTestApp();
        notebookSourceGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/source?action=guide&notebook=nb1&sourceId=s1')
            .set('Cookie', cookie());
        expect(res.status).toBe(204);
    });

    it('400 for unknown action', async () => {
        const { notebookSourceGet } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/source?action=bogus')
            .set('Cookie', cookie());
        expect(res.status).toBe(400);
    });
});

describe('POST /api/notebook/import', () => {
    it('imports a text source', async () => {
        nbImportSourceMock.mockReturnValue({ id: 's1' });
        nbGetSourceEntryMock.mockReturnValue({ id: 's1', content: 'body' });
        const { notebookImportSource } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookImportSource(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie())
            .send({ kind: 'text', title: 'T', content: 'long content here' });
        expect(res.status).toBe(200);
        expect(res.body.id).toBe('s1');
    });

    it('400 when text content is empty', async () => {
        const { notebookImportSource } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookImportSource(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie())
            .send({ kind: 'text', title: 'T', content: '' });
        expect(res.status).toBe(400);
    });

    it('400 when kind is unknown', async () => {
        const { notebookImportSource } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookImportSource(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie())
            .send({ kind: 'martian' });
        expect(res.status).toBe(400);
    });

    it('imports a document with pdf mime', async () => {
        nbImportSourceMock.mockReturnValue({ id: 'd1' });
        nbGetSourceEntryMock.mockReturnValue(null);
        const { notebookImportSource } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookImportSource(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/import')
            .set('Cookie', cookie())
            .send({ kind: 'document', filename: 'paper.pdf', mimeType: 'application/pdf', content: 'pdf body' });
        expect(res.status).toBe(200);
        expect(res.body.id).toBe('d1');
    });
});

describe('POST /api/notebook/source/archive & /rename', () => {
    it('archive 400 when missing fields', async () => {
        const { notebookSourceActions } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceActions(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source/archive')
            .set('Cookie', cookie()).send({});
        expect(res.status).toBe(400);
    });

    it('archive 404 when source missing', async () => {
        nbArchiveSourceMock.mockReturnValue(false);
        const { notebookSourceActions } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceActions(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source/archive')
            .set('Cookie', cookie()).send({ notebook: 'nb', sourceId: 's' });
        expect(res.status).toBe(404);
    });

    it('archive ok', async () => {
        nbArchiveSourceMock.mockReturnValue(true);
        const { notebookSourceActions } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceActions(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source/archive')
            .set('Cookie', cookie()).send({ notebook: 'nb', sourceId: 's' });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('rename 400 missing title', async () => {
        const { notebookSourceActions } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceActions(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source/rename')
            .set('Cookie', cookie()).send({ notebook: 'nb', sourceId: 's' });
        expect(res.status).toBe(400);
    });

    it('rename 404 when source missing', async () => {
        nbRenameSourceMock.mockReturnValue(null);
        const { notebookSourceActions } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceActions(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source/rename')
            .set('Cookie', cookie()).send({ notebook: 'nb', sourceId: 's', title: 'New' });
        expect(res.status).toBe(404);
    });

    it('rename ok', async () => {
        nbRenameSourceMock.mockReturnValue({ id: 's', title: 'New' });
        const { notebookSourceActions } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookSourceActions(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source/rename')
            .set('Cookie', cookie()).send({ notebook: 'nb', sourceId: 's', title: 'New' });
        expect(res.status).toBe(200);
        expect(res.body.title).toBe('New');
    });
});

describe('POST /api/notebook/source-guide', () => {
    it('400 missing fields', async () => {
        const { notebookGenerateGuide } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateGuide(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source-guide')
            .set('Cookie', cookie()).send({});
        expect(res.status).toBe(400);
    });

    it('404 when source missing', async () => {
        nbGetSourceEntryMock.mockReturnValue(null);
        const { notebookGenerateGuide } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateGuide(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source-guide')
            .set('Cookie', cookie()).send({ notebook: 'nb', sourceId: 'x' });
        expect(res.status).toBe(404);
    });

    it('200 when source exists', async () => {
        nbGetSourceEntryMock.mockReturnValue({ id: 's' });
        const { notebookGenerateGuide } = await import('../notebook-source.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateGuide(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/source-guide')
            .set('Cookie', cookie()).send({ notebook: 'nb', sourceId: 's' });
        expect(res.status).toBe(200);
    });
});

describe('GET /api/notebook/studio', () => {
    it('artifacts requires notebook', async () => {
        const { notebookStudioGet } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookStudioGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/studio?action=artifacts')
            .set('Cookie', cookie());
        expect(res.status).toBe(400);
    });

    it('artifacts list ok', async () => {
        nbListArtifactsMock.mockReturnValue([]);
        const { notebookStudioGet } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookStudioGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/studio?action=artifacts&notebook=nb&type=report')
            .set('Cookie', cookie());
        expect(res.status).toBe(200);
    });

    it('artifact 404 when missing', async () => {
        nbGetArtifactMock.mockReturnValue(null);
        const { notebookStudioGet } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookStudioGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/studio?action=artifact&notebook=nb&id=a1')
            .set('Cookie', cookie());
        expect(res.status).toBe(404);
    });

    it('400 unknown action', async () => {
        const { notebookStudioGet } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookStudioGet(router); mount();
        const res = await request(app.callback())
            .get('/api/notebook/studio?action=bogus')
            .set('Cookie', cookie());
        expect(res.status).toBe(400);
    });
});

describe('POST /api/notebook/artifact', () => {
    it('400 missing notebook+type', async () => {
        const { notebookGenerateArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateArtifact(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie()).send({});
        expect(res.status).toBe(400);
    });

    it('400 unknown artifact type', async () => {
        const { notebookGenerateArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateArtifact(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie()).send({ notebook: 'nb', type: 'foo' });
        expect(res.status).toBe(400);
    });

    it('mindmap ok', async () => {
        const { notebookGenerateArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateArtifact(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie()).send({ notebook: 'nb', type: 'mindmap' });
        expect(res.status).toBe(200);
        expect(res.body.id).toBe('m1');
    });

    it('passes article affinity to artifact generation', async () => {
        const notebookAi = await import('../../services/notebook-ai.js');
        const { notebookGenerateArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateArtifact(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie()).send({
                notebook: 'nb',
                type: 'mindmap',
                sourceIds: ['s1'],
                primaryArticleId: 'notebooks/nb/s1.md',
            });
        expect(res.status).toBe(200);
        expect(notebookAi.generateMindMap).toHaveBeenLastCalledWith(
            workDir,
            'nb',
            ['s1'],
            undefined,
            undefined,
            undefined,
            { primaryArticleId: 'notebooks/nb/s1.md' },
        );
    });

    it('audio ok', async () => {
        const { notebookGenerateArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateArtifact(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie()).send({ notebook: 'nb', type: 'audio' });
        expect(res.status).toBe(200);
    });

    it('passes audio custom prompt to artifact generation', async () => {
        const notebookAi = await import('../../services/notebook-ai.js');
        const { notebookGenerateArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookGenerateArtifact(router); mount();
        const res = await request(app.callback())
            .post('/api/notebook/artifact')
            .set('Cookie', cookie()).send({
                notebook: 'nb',
                type: 'audio',
                sourceIds: ['s1'],
                primaryArticleId: 'notebooks/nb/s1.md',
                customPrompt: '更像摘要节目',
                audioMode: 'single',
            });
        expect(res.status).toBe(200);
        expect(notebookAi.generateAudioScript).toHaveBeenLastCalledWith(
            workDir,
            'nb',
            ['s1'],
            undefined,
            undefined,
            { primaryArticleId: 'notebooks/nb/s1.md', customPrompt: '更像摘要节目', audioMode: 'single' },
        );
    });
});

describe('DELETE /api/notebook/artifact', () => {
    it('400 missing fields', async () => {
        const { notebookDeleteArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookDeleteArtifact(router); mount();
        const res = await request(app.callback())
            .delete('/api/notebook/artifact?notebook=nb')
            .set('Cookie', cookie());
        expect(res.status).toBe(400);
    });

    it('404 not found', async () => {
        nbDeleteArtifactMock.mockReturnValue(false);
        const { notebookDeleteArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookDeleteArtifact(router); mount();
        const res = await request(app.callback())
            .delete('/api/notebook/artifact?notebook=nb&id=x')
            .set('Cookie', cookie());
        expect(res.status).toBe(404);
    });

    it('ok', async () => {
        nbDeleteArtifactMock.mockReturnValue(true);
        const { notebookDeleteArtifact } = await import('../notebook-studio.js');
        const { app, router, mount } = createTestApp();
        notebookDeleteArtifact(router); mount();
        const res = await request(app.callback())
            .delete('/api/notebook/artifact?notebook=nb&id=a1')
            .set('Cookie', cookie());
        expect(res.status).toBe(200);
    });
});
