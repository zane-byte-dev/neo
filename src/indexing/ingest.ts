import { readFacts } from '../memory/semantic-store.js';
import {
    nbGetSourceEntry,
    nbListNotes,
    nbListNotebooksProper,
    nbListSources,
    sourceIdFromEntryId,
} from '../services/notebook-service.js';
import { getKnowledgeDb } from './db.js';
import type { KnowledgeRebuildSummary } from './types.js';
import {
    clearKnowledgeIndex,
    deleteDocumentIndex,
    indexSemanticFactRecord,
    removeNotebookSourceIndex,
    upsertNotebookNoteIndex,
    upsertNotebookSourceIndex,
} from './writers.js';

function sourceDocumentId(notebook: string, sourceId: string): string {
    return `notebook_source:${notebook}:${sourceId}`;
}

function semanticDocumentId(factId: string): string {
    return `memory_semantic:${factId}`;
}

export function indexNotebookSource(workDir: string, notebook: string, sourceId: string): boolean {
    const entry = nbGetSourceEntry(workDir, notebook, sourceId);
    if (!entry?.content) {
        removeNotebookSourceIndex(workDir, notebook, sourceId);
        return false;
    }

    return upsertNotebookSourceIndex(workDir, {
        notebook,
        entryId: entry.id,
        title: entry.title,
        source: entry.source,
        summary: entry.summary,
        tagsJson: entry.tags,
        content: entry.content,
    });
}

export function indexNotebookSources(workDir: string, notebook: string, sourceIds?: string[]): number {
    const allSources = nbListSources(workDir, notebook);
    const targets = sourceIds?.length
        ? allSources.filter((source) => sourceIds.includes(source.id))
        : allSources;

    let indexed = 0;
    for (const source of targets) {
        if (indexNotebookSource(workDir, notebook, source.id)) indexed += 1;
    }

    if (!sourceIds?.length) {
        const db = getKnowledgeDb(workDir);
        const knownSourceIds = new Set(allSources.map((source) => source.id));
        const existing = db.prepare(
            'SELECT document_id AS documentId, source_id AS sourceId FROM documents WHERE kind = ? AND notebook = ?',
        ).all('notebook_source', notebook) as Array<{ documentId: string; sourceId: string | null }>;

        for (const row of existing) {
            if (!row.sourceId || knownSourceIds.has(row.sourceId)) continue;
            deleteDocumentIndex(workDir, row.documentId);
        }
    }

    return indexed;
}

export function indexNotebookNotes(workDir: string, notebook: string): number {
    const notes = nbListNotes(workDir, notebook);
    let indexed = 0;

    for (const note of notes) {
        if (upsertNotebookNoteIndex(workDir, {
            notebook,
            noteId: note.id,
            title: note.title,
            content: note.content,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
        })) {
            indexed += 1;
        }
    }

    const db = getKnowledgeDb(workDir);
    const knownNoteIds = new Set(notes.map((note) => note.id));
    const existing = db.prepare(
        'SELECT document_id AS documentId, source_id AS sourceId FROM documents WHERE kind = ? AND notebook = ?',
    ).all('notebook_note', notebook) as Array<{ documentId: string; sourceId: string | null }>;

    for (const row of existing) {
        if (!row.sourceId || knownNoteIds.has(row.sourceId)) continue;
        deleteDocumentIndex(workDir, row.documentId);
    }

    return indexed;
}

export async function indexSemanticMemory(workDir: string): Promise<number> {
    const facts = await readFacts(workDir);
    let indexed = 0;

    for (const fact of facts) {
        if (indexSemanticFactRecord(workDir, fact)) indexed += 1;
    }

    const db = getKnowledgeDb(workDir);
    const knownFactIds = new Set(facts.map((fact) => semanticDocumentId(fact.id)));
    const existing = db.prepare(
        'SELECT document_id AS documentId FROM documents WHERE kind = ?',
    ).all('memory_semantic') as Array<{ documentId: string }>;

    for (const row of existing) {
        if (knownFactIds.has(row.documentId)) continue;
        deleteDocumentIndex(workDir, row.documentId);
    }

    return indexed;
}

export async function rebuildKnowledgeIndex(workDir: string): Promise<KnowledgeRebuildSummary> {
    clearKnowledgeIndex(workDir);

    const notebooks = nbListNotebooksProper(workDir);
    const summary: KnowledgeRebuildSummary = {
        notebooks: notebooks.length,
        notebookSources: 0,
        notebookNotes: 0,
        semanticFacts: 0,
    };

    for (const notebook of notebooks) {
        summary.notebookSources += indexNotebookSources(workDir, notebook);
        summary.notebookNotes += indexNotebookNotes(workDir, notebook);
    }

    summary.semanticFacts = await indexSemanticMemory(workDir);
    return summary;
}

export function indexNotebookSourceFromEntryId(workDir: string, notebook: string, entryId: string): boolean {
    return indexNotebookSource(workDir, notebook, sourceIdFromEntryId(entryId));
}