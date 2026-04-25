import { createHash } from 'node:crypto';
import type { EpisodeCard, SemanticFact } from '../memory/types.js';
import { buildKnowledgeChunks } from './chunker.js';
import { getKnowledgeDb } from './db.js';
import type { KnowledgeChunkSeed, KnowledgeDocumentInput } from './types.js';

export interface NotebookSourceIndexRecord {
    notebook: string;
    entryId: string;
    title: string;
    source: string | null;
    summary: string | null;
    tagsJson: string | null;
    content: string;
    createdAt?: number;
    updatedAt?: number;
}

export interface NotebookNoteIndexRecord {
    notebook: string;
    noteId: string;
    title: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

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

export function episodicDocumentId(cardId: string): string {
    return `memory_episodic:${cardId}`;
}

export function semanticDocumentId(factId: string): string {
    return `memory_semantic:${factId}`;
}

export function sourceIdFromEntryId(entryId: string): string {
    const parts = entryId.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
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

export function upsertNotebookSourceIndex(workDir: string, record: NotebookSourceIndexRecord): boolean {
    const sourceId = sourceIdFromEntryId(record.entryId);
    const checksum = checksumOf(JSON.stringify({
        title: record.title,
        source: record.source,
        summary: record.summary,
        tags: record.tagsJson,
        content: record.content,
    }));
    const now = record.updatedAt ?? Date.now();

    return upsertDocumentWithChunks(
        workDir,
        {
            documentId: sourceDocumentId(record.notebook, sourceId),
            kind: 'notebook_source',
            scope: 'notebook',
            notebook: record.notebook,
            sourceId,
            sourcePath: record.entryId,
            sourceUrl: record.source,
            title: record.title,
            summary: record.summary,
            tagsJson: record.tagsJson,
            checksum,
            createdAt: record.createdAt ?? now,
            updatedAt: now,
        },
        buildKnowledgeChunks({ text: record.content }),
    );
}

export function removeNotebookSourceIndex(workDir: string, notebook: string, sourceId: string): void {
    deleteDocumentIndex(workDir, sourceDocumentId(notebook, sourceId));
}

export function upsertNotebookNoteIndex(workDir: string, record: NotebookNoteIndexRecord): boolean {
    const checksum = checksumOf(JSON.stringify({
        title: record.title,
        content: record.content,
    }));

    return upsertDocumentWithChunks(
        workDir,
        {
            documentId: noteDocumentId(record.notebook, record.noteId),
            kind: 'notebook_note',
            scope: 'notebook',
            notebook: record.notebook,
            sourceId: record.noteId,
            sourcePath: `.neo/notebooks/${record.notebook}/notes/${record.noteId}.md`,
            title: record.title,
            summary: record.content.slice(0, 200),
            checksum,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        },
        buildKnowledgeChunks({ text: record.content }),
    );
}

export function removeNotebookNoteIndex(workDir: string, notebook: string, noteId: string): void {
    deleteDocumentIndex(workDir, noteDocumentId(notebook, noteId));
}

export function indexEpisodeCardRecord(workDir: string, card: EpisodeCard): boolean {
    const checksum = checksumOf(JSON.stringify({ text: card.text, meta: card.meta }));
    const title = card.meta.role === 'assistant'
        ? `assistant:${card.text.slice(0, 48)}`
        : `user:${card.text.slice(0, 48)}`;

    return upsertDocumentWithChunks(
        workDir,
        {
            documentId: episodicDocumentId(card.id),
            userId: card.meta.userId ?? null,
            kind: 'memory_episodic',
            scope: 'memory',
            sessionId: card.meta.sessionId,
            sourcePath: card.meta.source ?? `.neo/memory/episodes/${card.ts.slice(0, 7)}.jsonl#${card.id}`,
            title,
            summary: card.text.slice(0, 200),
            tagsJson: JSON.stringify({ role: card.meta.role }),
            checksum,
            createdAt: Date.parse(card.ts) || Date.now(),
            updatedAt: Date.parse(card.ts) || Date.now(),
        },
        buildKnowledgeChunks({ text: card.text }),
    );
}

export function removeEpisodicIndex(workDir: string, cardId: string): void {
    deleteDocumentIndex(workDir, episodicDocumentId(cardId));
}

export function indexSemanticFactRecord(workDir: string, fact: SemanticFact): boolean {
    const checksum = checksumOf(JSON.stringify({ text: fact.text, meta: fact.meta }));
    const title = fact.meta?.category
        ? `${fact.meta.category}: ${fact.text.slice(0, 48)}`
        : fact.text.slice(0, 64);

    return upsertDocumentWithChunks(
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
}