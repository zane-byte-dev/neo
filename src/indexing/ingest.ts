import { createHash } from 'node:crypto';
import { readFacts } from '../memory/semantic-store.js';
import {
    nbGetSourceEntry,
    nbListNotes,
    nbListNotebooksProper,
    nbListSources,
    sourceIdFromEntryId,
} from '../services/notebook-service.js';
import { getKnowledgeDb } from './db.js';
import { buildKnowledgeChunks } from './chunker.js';
import type { KnowledgeChunkSeed, KnowledgeDocumentInput, KnowledgeRebuildSummary } from './types.js';

function checksumOf(value: string): string {
    return createHash('sha1').update(value).digest('hex');
}

function toTokenEstimate(text: string): number {
    return Math.ceil(text.length / 4);
}

function sourceDocumentId(notebook: string, sourceId: string): string {
    return `notebook_source:${notebook}:${sourceId}`;
}

function noteDocumentId(notebook: string, noteId: string): string {
    return `notebook_note:${notebook}:${noteId}`;
}

function semanticDocumentId(factId: string): string {
    return `memory_semantic:${factId}`;
}

function upsertDocumentWithChunks(
    workDir: string,
    document: KnowledgeDocumentInput,
    chunks: KnowledgeChunkSeed[],
): boolean {
    const db = getKnowledgeDb(workDir);
    const existing = db.prepare(
        'SELECT checksum, created_at AS createdAt FROM documents WHERE document_id = ?',
    ).get(document.documentId) as { checksum: string; createdAt: number } | undefined;

    if (existing?.checksum === document.checksum) {
        db.prepare('UPDATE documents SET deleted_at = NULL WHERE document_id = ?').run(document.documentId);
        return false;
    }

    const insertDocument = db.prepare(`
        INSERT INTO documents (
            document_id, user_id, kind, scope, notebook, session_id, source_id,
            source_path, source_url, title, summary, tags_json, checksum,
            created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(document_id) DO UPDATE SET
            user_id = excluded.user_id,
            kind = excluded.kind,
            scope = excluded.scope,
            notebook = excluded.notebook,
            session_id = excluded.session_id,
            source_id = excluded.source_id,
            source_path = excluded.source_path,
            source_url = excluded.source_url,
            title = excluded.title,
            summary = excluded.summary,
            tags_json = excluded.tags_json,
            checksum = excluded.checksum,
            updated_at = excluded.updated_at,
            deleted_at = NULL
    `);

    const deleteChunks = db.prepare('DELETE FROM chunks WHERE document_id = ?');
    const deleteFts = db.prepare('DELETE FROM chunk_fts WHERE document_id = ?');
    const insertChunk = db.prepare(`
        INSERT INTO chunks (
            chunk_id, document_id, ordinal, heading_path, char_start, char_end,
            token_estimate, text, checksum, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(
        'INSERT INTO chunk_fts (chunk_id, document_id, title, heading_path, text) VALUES (?, ?, ?, ?, ?)',
    );

    const tx = db.transaction(() => {
        deleteFts.run(document.documentId);
        deleteChunks.run(document.documentId);
        insertDocument.run(
            document.documentId,
            document.userId ?? null,
            document.kind,
            document.scope,
            document.notebook ?? null,
            document.sessionId ?? null,
            document.sourceId ?? null,
            document.sourcePath,
            document.sourceUrl ?? null,
            document.title,
            document.summary ?? null,
            document.tagsJson ?? null,
            document.checksum,
            existing?.createdAt ?? document.createdAt,
            document.updatedAt,
        );

        for (const chunk of chunks) {
            const chunkId = `${document.documentId}:${chunk.ordinal}`;
            insertChunk.run(
                chunkId,
                document.documentId,
                chunk.ordinal,
                chunk.headingPath ?? null,
                chunk.charStart,
                chunk.charEnd,
                toTokenEstimate(chunk.text),
                chunk.text,
                checksumOf(chunk.text),
                document.updatedAt,
            );
            insertFts.run(
                chunkId,
                document.documentId,
                document.title,
                chunk.headingPath ?? null,
                chunk.text,
            );
        }
    });

    tx();
    return true;
}

export function deleteDocumentIndex(workDir: string, documentId: string): void {
    const db = getKnowledgeDb(workDir);
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM chunk_fts WHERE document_id = ?').run(documentId);
        db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
        db.prepare('DELETE FROM documents WHERE document_id = ?').run(documentId);
    });
    tx();
}

export function clearKnowledgeIndex(workDir: string): void {
    const db = getKnowledgeDb(workDir);
    db.exec('DELETE FROM chunk_fts; DELETE FROM chunks; DELETE FROM documents; DELETE FROM ingest_jobs;');
}

export function indexNotebookSource(workDir: string, notebook: string, sourceId: string): boolean {
    const entry = nbGetSourceEntry(workDir, notebook, sourceId);
    if (!entry?.content) {
        deleteDocumentIndex(workDir, sourceDocumentId(notebook, sourceId));
        return false;
    }

    const now = Date.now();
    const checksum = checksumOf(JSON.stringify({
        title: entry.title,
        source: entry.source,
        summary: entry.summary,
        tags: entry.tags,
        content: entry.content,
    }));

    return upsertDocumentWithChunks(
        workDir,
        {
            documentId: sourceDocumentId(notebook, sourceId),
            kind: 'notebook_source',
            scope: 'notebook',
            notebook,
            sourceId,
            sourcePath: entry.id,
            sourceUrl: entry.source,
            title: entry.title,
            summary: entry.summary,
            tagsJson: entry.tags,
            checksum,
            createdAt: now,
            updatedAt: now,
        },
        buildKnowledgeChunks({ text: entry.content }),
    );
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
        const checksum = checksumOf(JSON.stringify({ title: note.title, content: note.content, source: note.source }));
        const changed = upsertDocumentWithChunks(
            workDir,
            {
                documentId: noteDocumentId(notebook, note.id),
                kind: 'notebook_note',
                scope: 'notebook',
                notebook,
                sourceId: note.id,
                sourcePath: `.neo/notebooks/${notebook}/notes/${note.id}.md`,
                title: note.title,
                summary: note.content.slice(0, 200),
                checksum,
                createdAt: note.createdAt,
                updatedAt: note.updatedAt,
            },
            buildKnowledgeChunks({ text: note.content }),
        );
        if (changed) indexed += 1;
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
        const checksum = checksumOf(JSON.stringify({ text: fact.text, meta: fact.meta }));
        const title = fact.meta?.category
            ? `${fact.meta.category}: ${fact.text.slice(0, 48)}`
            : fact.text.slice(0, 64);
        const changed = upsertDocumentWithChunks(
            workDir,
            {
                documentId: semanticDocumentId(fact.id),
                userId: fact.meta?.userId ?? null,
                kind: 'memory_semantic',
                scope: 'memory',
                sourcePath: fact.meta?.source ?? `.neo/memory/semantic.jsonl#${fact.id}`,
                title,
                summary: fact.text.slice(0, 200),
                checksum,
                createdAt: Date.parse(fact.ts) || Date.now(),
                updatedAt: Date.parse(fact.ts) || Date.now(),
            },
            buildKnowledgeChunks({ text: fact.text }),
        );
        if (changed) indexed += 1;
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