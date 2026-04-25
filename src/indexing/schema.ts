export const KNOWLEDGE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    user_id TEXT,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    notebook TEXT,
    session_id TEXT,
    source_id TEXT,
    source_path TEXT NOT NULL,
    source_url TEXT,
    title TEXT NOT NULL,
    summary TEXT,
    tags_json TEXT,
    checksum TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind);
CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents(scope);
CREATE INDEX IF NOT EXISTS idx_documents_notebook ON documents(notebook);
CREATE INDEX IF NOT EXISTS idx_documents_source_id ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    heading_path TEXT,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    token_estimate INTEGER,
    text TEXT NOT NULL,
    checksum TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_document_ordinal
    ON chunks(document_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_char_start ON chunks(document_id, char_start);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    chunk_id UNINDEXED,
    document_id UNINDEXED,
    title,
    heading_path,
    text,
    tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS ingest_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    document_id TEXT,
    source_path TEXT,
    status TEXT NOT NULL,
    error_text TEXT,
    payload_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_document_id ON ingest_jobs(document_id);

CREATE VIEW IF NOT EXISTS searchable_chunks AS
SELECT
    d.document_id,
    d.kind,
    d.scope,
    d.notebook,
    d.session_id,
    d.source_id,
    d.source_path,
    d.source_url,
    d.title,
    d.summary,
    d.tags_json,
    d.updated_at,
    c.chunk_id,
    c.ordinal,
    c.heading_path,
    c.char_start,
    c.char_end,
    c.token_estimate,
    c.text
FROM documents d
JOIN chunks c ON c.document_id = d.document_id
WHERE d.deleted_at IS NULL;
`;