import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rememberFact, rememberTurn } from '../../memory/manager.js';
import { closeKnowledgeDb } from '../db.js';
import { rebuildKnowledgeIndex } from '../ingest.js';
import { searchKnowledge } from '../search.js';
import { nbImportSource, nbSaveNote } from '../../services/notebook-service.js';

describe('indexing/rebuild', () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'neo-index-rebuild-'));
    });

    afterEach(async () => {
        closeKnowledgeDb(workDir);
        await rm(workDir, { recursive: true, force: true });
    });

    it('rebuilds notebook, episodic, and semantic content into the unified index', async () => {
        nbImportSource(workDir, 'research', {
            title: 'Agent Runtime Notes',
            content: 'TypeScript agent runtime needs durable checkpoint recovery.',
            type: 'text',
        });
        nbSaveNote(workDir, 'research', {
            title: 'Index Note',
            content: 'SQLite FTS keeps notebook retrieval fast.',
            source: 'user',
        });
        await rememberTurn(workDir, {
            sessionId: 'sess-1',
            userId: 'u-1',
            userMsg: '请记录 agent runtime 的恢复策略',
            assistantMsg: 'agent runtime 需要 checkpoint 和 pending action 恢复',
        });
        await rememberFact(workDir, {
            text: '用户持续关注 agent runtime checkpoint 设计',
            category: 'goal',
            userId: 'u-1',
        });

        const summary = await rebuildKnowledgeIndex(workDir);

        expect(summary).toEqual({
            notebooks: 1,
            notebookSources: 1,
            notebookNotes: 1,
            episodicEpisodes: 2,
            semanticFacts: 1,
        });

        const sourceHits = searchKnowledge({ workDir, query: 'TypeScript', kinds: ['notebook_source'] });
        const noteHits = searchKnowledge({ workDir, query: 'SQLite', kinds: ['notebook_note'] });
        const episodicHits = searchKnowledge({ workDir, query: 'runtime', kinds: ['memory_episodic'] });
        const semanticHits = searchKnowledge({ workDir, query: 'checkpoint', kinds: ['memory_semantic'] });

        expect(sourceHits[0]?.title).toBe('Agent Runtime Notes');
        expect(noteHits[0]?.title).toBe('Index Note');
        expect(episodicHits.some((hit) => hit.text.includes('pending action'))).toBe(true);
        expect(semanticHits[0]?.text).toContain('checkpoint');
    });
});