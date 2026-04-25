import { getKnowledgeDb } from './db.js';
import type { KnowledgeHit, SearchKnowledgeOptions } from './types.js';

interface SearchRow {
    document_id: string;
    kind: KnowledgeHit['kind'];
    scope: KnowledgeHit['scope'];
    notebook: string | null;
    session_id: string | null;
    source_id: string | null;
    source_path: string;
    source_url: string | null;
    title: string;
    summary: string | null;
    tags_json: string | null;
    updated_at: number;
    chunk_id: string;
    ordinal: number;
    heading_path: string | null;
    char_start: number;
    char_end: number;
    token_estimate: number | null;
    text: string;
    score: number;
}

function buildFilterSql(opts: SearchKnowledgeOptions): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (opts.kinds?.length) {
        clauses.push(`sc.kind IN (${opts.kinds.map(() => '?').join(', ')})`);
        params.push(...opts.kinds);
    }

    if (opts.notebook) {
        clauses.push('sc.notebook = ?');
        params.push(opts.notebook);
    }

    if (opts.sourceIds?.length) {
        clauses.push(`sc.source_id IN (${opts.sourceIds.map(() => '?').join(', ')})`);
        params.push(...opts.sourceIds);
    }

    return {
        sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
        params,
    };
}

function toFtsMatch(query: string): string | null {
    const asciiTerms = query
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length > 1);

    const terms = [...new Set(asciiTerms)];
    if (!terms.length) return null;
    return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
}

function mapRows(rows: SearchRow[]): KnowledgeHit[] {
    return rows.map((row) => ({
        documentId: row.document_id,
        chunkId: row.chunk_id,
        kind: row.kind,
        scope: row.scope,
        notebook: row.notebook,
        sessionId: row.session_id,
        sourceId: row.source_id,
        sourcePath: row.source_path,
        sourceUrl: row.source_url,
        title: row.title,
        summary: row.summary,
        tagsJson: row.tags_json,
        ordinal: row.ordinal,
        headingPath: row.heading_path,
        charStart: row.char_start,
        charEnd: row.char_end,
        tokenEstimate: row.token_estimate,
        text: row.text,
        updatedAt: row.updated_at,
        score: row.score,
    }));
}

function runLikeFallback(opts: SearchKnowledgeOptions, filters: { sql: string; params: unknown[] }): KnowledgeHit[] {
    const db = getKnowledgeDb(opts.workDir);
    const query = opts.query.trim();
    if (!query) return [];

    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const likeValue = `%${query}%`;
    const rows = db.prepare(`
        SELECT
            sc.*,
            (
                CASE WHEN sc.title LIKE ? THEN 3 ELSE 0 END +
                CASE WHEN sc.text LIKE ? THEN 2 ELSE 0 END
            ) AS score
        FROM searchable_chunks sc
        WHERE (sc.title LIKE ? OR sc.text LIKE ?)
        ${filters.sql}
        ORDER BY score DESC, sc.updated_at DESC, sc.ordinal ASC
        LIMIT ?
    `).all(
        likeValue,
        likeValue,
        likeValue,
        likeValue,
        ...filters.params,
        limit,
    ) as SearchRow[];

    return mapRows(rows.filter((row) => row.score > 0));
}

export function searchKnowledge(opts: SearchKnowledgeOptions): KnowledgeHit[] {
    const db = getKnowledgeDb(opts.workDir);
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const filters = buildFilterSql(opts);
    const ftsMatch = toFtsMatch(opts.query);

    if (ftsMatch) {
        const rows = db.prepare(`
            SELECT
                sc.*,
                (1.0 / (1.0 + bm25(chunk_fts))) AS score
            FROM chunk_fts
            JOIN searchable_chunks sc ON sc.chunk_id = chunk_fts.chunk_id
            WHERE chunk_fts MATCH ?
            ${filters.sql}
            ORDER BY bm25(chunk_fts) ASC, sc.updated_at DESC, sc.ordinal ASC
            LIMIT ?
        `).all(ftsMatch, ...filters.params, limit) as SearchRow[];

        const mapped = mapRows(rows);
        if (mapped.length) return mapped;
    }

    return runLikeFallback(opts, filters);
}