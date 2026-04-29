import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { KNOWLEDGE_SCHEMA_SQL } from './schema.js';

type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

const _dbCache = new Map<string, SqliteDatabase>();

function indexDir(workDir: string): string {
    return join(workDir, 'index');
}

export function knowledgeDbPath(workDir: string): string {
    return join(indexDir(workDir), 'knowledge.db');
}

export function getKnowledgeDb(workDir: string): SqliteDatabase {
    const resolvedWorkDir = resolve(workDir);
    const cached = _dbCache.get(resolvedWorkDir);
    if (cached) return cached;

    mkdirSync(indexDir(resolvedWorkDir), { recursive: true });

    const db = new BetterSqlite3(knowledgeDbPath(resolvedWorkDir));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(KNOWLEDGE_SCHEMA_SQL);

    _dbCache.set(resolvedWorkDir, db);
    return db;
}

export function closeKnowledgeDb(workDir: string): void {
    const resolvedWorkDir = resolve(workDir);
    const db = _dbCache.get(resolvedWorkDir);
    if (!db) return;
    db.close();
    _dbCache.delete(resolvedWorkDir);
}

export function closeAllKnowledgeDbs(): void {
    for (const [, db] of _dbCache) db.close();
    _dbCache.clear();
}