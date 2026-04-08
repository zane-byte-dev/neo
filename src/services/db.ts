/**
 * db.ts — SQLite singleton for all runtime state.
 *
 * Replaces all per-tenant JSON files in ./cache/.
 * Schema covers: chat_sessions, chat_messages, async_tasks, message_queue,
 * reminders, scheduled_tasks, todos, notes (inbox), tasks, user_profile.
 *
 * Call initDb() once at startup (app.ts).
 * Call getDb() anywhere else to access the shared instance.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { DB_PATH as DEFAULT_DB_PATH } from '../config.js';

let _db: Database.Database | null = null;

export function initDb(dbPath?: string): Database.Database {
    const path = dbPath ?? resolve(DEFAULT_DB_PATH);
    mkdirSync(dirname(path), { recursive: true });

    _db = new Database(path);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    createSchema(_db);
    console.log(`[DB] ✅ SQLite initialized: ${path}`);
    return _db;
}

export function getDb(): Database.Database {
    if (!_db) throw new Error('[DB] Not initialized. Call initDb() first.');
    return _db;
}

function createSchema(db: Database.Database): void {
    db.exec(`
        -- ── Chat ────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id          TEXT    PRIMARY KEY,
            tenant_key  TEXT    NOT NULL,
            start_time  TEXT    NOT NULL,
            end_time    TEXT    NOT NULL,
            is_current  INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON chat_sessions(tenant_key);

        CREATE TABLE IF NOT EXISTS chat_messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT    NOT NULL,
            tenant_key  TEXT    NOT NULL,
            role        TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            user_name   TEXT,
            timestamp   TEXT    NOT NULL,
            FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_tenant  ON chat_messages(tenant_key, timestamp);

        -- ── Async tasks ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS async_tasks (
            id          TEXT    PRIMARY KEY,
            tenant_key  TEXT    NOT NULL,
            chat_id     TEXT    NOT NULL,
            prompt      TEXT    NOT NULL,
            status      TEXT    NOT NULL,
            result      TEXT,
            error       TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_async_tenant ON async_tasks(tenant_key);

        -- ── Message queue ────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS message_queue (
            id          TEXT    PRIMARY KEY,
            tenant_key  TEXT    NOT NULL,
            chat_id     TEXT    NOT NULL,
            question    TEXT    NOT NULL,
            user_name   TEXT    NOT NULL,
            message_id  TEXT    NOT NULL,
            status      TEXT    NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_queue_tenant ON message_queue(tenant_key, status);

        -- ── Reminders ────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS reminders (
            id          TEXT    PRIMARY KEY,
            tenant_key  TEXT    NOT NULL,
            chat_id     TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            prompt      TEXT,
            fire_at     INTEGER NOT NULL,
            created_at  INTEGER NOT NULL,
            fired       INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_tenant ON reminders(tenant_key, fire_at);

        -- ── Scheduled tasks ──────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id          TEXT    PRIMARY KEY,
            tenant_key  TEXT    NOT NULL,
            chat_id     TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            prompt      TEXT    NOT NULL,
            cron_expr   TEXT    NOT NULL,
            created_at  INTEGER NOT NULL,
            enabled     INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON scheduled_tasks(tenant_key);

        -- ── AI todos (per-session task tracking) ─────────────────────────────
        CREATE TABLE IF NOT EXISTS todos (
            id          TEXT    PRIMARY KEY,
            tenant_key  TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            status      TEXT    NOT NULL,
            priority    TEXT,
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_todos_tenant ON todos(tenant_key);

        -- ── Notes (was 0-Inbox) ──────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_key  TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            date        TEXT    NOT NULL,
            time        TEXT    NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_tenant_date ON notes(tenant_key, date);

        -- ── User tasks (was 2-Tasks) ─────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS tasks (
            id          TEXT    PRIMARY KEY,
            tenant_key  TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            status      TEXT    NOT NULL DEFAULT 'open',
            date        TEXT    NOT NULL,
            time        TEXT    NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks(tenant_key, status);

        -- ── User profile ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS user_profile (
            tenant_key  TEXT    PRIMARY KEY,
            data        TEXT    NOT NULL,
            updated_at  INTEGER NOT NULL
        );
    `);
}
