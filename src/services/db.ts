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
            remind_at   TEXT,
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
            created_at  INTEGER NOT NULL,
            tags        TEXT
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

        -- ── Notebook (knowledge base entries) ────────────────────────────────
        CREATE TABLE IF NOT EXISTS notebook_entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            author      TEXT,
            date        TEXT,
            source      TEXT,
            summary     TEXT,
            tags        TEXT,
            content     TEXT,
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notebook_date   ON notebook_entries(date);
        CREATE INDEX IF NOT EXISTS idx_notebook_source ON notebook_entries(source);

        CREATE VIRTUAL TABLE IF NOT EXISTS notebook_fts USING fts5(
            title, author, source, summary, tags, content,
            content='notebook_entries',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS notebook_ai AFTER INSERT ON notebook_entries BEGIN
            INSERT INTO notebook_fts(rowid, title, author, source, summary, tags, content)
            VALUES (new.id, new.title, new.author, new.source, new.summary, new.tags, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS notebook_ad AFTER DELETE ON notebook_entries BEGIN
            INSERT INTO notebook_fts(notebook_fts, rowid, title, author, source, summary, tags, content)
            VALUES ('delete', old.id, old.title, old.author, old.source, old.summary, old.tags, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS notebook_au AFTER UPDATE ON notebook_entries BEGIN
            INSERT INTO notebook_fts(notebook_fts, rowid, title, author, source, summary, tags, content)
            VALUES ('delete', old.id, old.title, old.author, old.source, old.summary, old.tags, old.content);
            INSERT INTO notebook_fts(rowid, title, author, source, summary, tags, content)
            VALUES (new.id, new.title, new.author, new.source, new.summary, new.tags, new.content);
        END;

        -- ── Cron jobs (code-defined, DB-managed metadata) ────────────────────
        CREATE TABLE IF NOT EXISTS cron_jobs (
            name        TEXT    PRIMARY KEY,
            schedule    TEXT    NOT NULL,
            description TEXT,
            enabled     INTEGER NOT NULL DEFAULT 1,
            updated_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cron_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name    TEXT    NOT NULL,
            status      TEXT    NOT NULL,
            started_at  INTEGER NOT NULL,
            finished_at INTEGER,
            duration_ms INTEGER,
            error       TEXT,
            summary     TEXT,
            FOREIGN KEY (job_name) REFERENCES cron_jobs(name) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_name, started_at DESC);
    `);

    // ── Unified todos_v2 table ─────────────────────────────────────────────
    db.exec(`
        CREATE TABLE IF NOT EXISTS todos_v2 (
            id          TEXT    PRIMARY KEY,
            scope_key   TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            status      TEXT    NOT NULL DEFAULT 'pending',
            priority    TEXT,
            prompt      TEXT,
            fire_at     INTEGER,
            cron_expr   TEXT,
            fired       INTEGER NOT NULL DEFAULT 0,
            enabled     INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_todos_v2_scope  ON todos_v2(scope_key);
        CREATE INDEX IF NOT EXISTS idx_todos_v2_fire   ON todos_v2(scope_key, fire_at) WHERE fire_at IS NOT NULL AND fired = 0;
        CREATE INDEX IF NOT EXISTS idx_todos_v2_cron   ON todos_v2(scope_key, enabled)  WHERE cron_expr IS NOT NULL;
    `);

    // ── Migrations ─────────────────────────────────────────────────────────
    // Add remind_at to todos if missing (for existing DBs)
    try { db.exec('ALTER TABLE todos ADD COLUMN remind_at TEXT'); } catch { /* already exists */ }
    // Add tags to notes if missing (for existing DBs)
    try { db.exec('ALTER TABLE notes ADD COLUMN tags TEXT'); } catch { /* already exists */ }

    // Migrate reminders → todos_v2
    try {
        const existingReminders = db.prepare(
            `SELECT id, tenant_key, content, prompt, fire_at, created_at, fired FROM reminders`
        ).all() as any[];
        if (existingReminders.length > 0) {
            const insert = db.prepare(
                `INSERT OR IGNORE INTO todos_v2 (id, scope_key, content, status, prompt, fire_at, fired, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const r of existingReminders) {
                insert.run(r.id, r.tenant_key, r.content, r.fired ? 'done' : 'pending', r.prompt ?? null, r.fire_at, r.fired, r.created_at, r.created_at);
            }
            console.log(`[DB] Migrated ${existingReminders.length} reminders → todos_v2`);
        }
    } catch { /* table may not exist or already migrated */ }

    // Migrate scheduled_tasks → todos_v2
    try {
        const existingSchedules = db.prepare(
            `SELECT id, tenant_key, content, prompt, cron_expr, created_at, enabled FROM scheduled_tasks`
        ).all() as any[];
        if (existingSchedules.length > 0) {
            const insert = db.prepare(
                `INSERT OR IGNORE INTO todos_v2 (id, scope_key, content, status, prompt, cron_expr, enabled, created_at, updated_at)
                 VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
            );
            for (const s of existingSchedules) {
                insert.run(s.id, s.tenant_key, s.content, s.prompt, s.cron_expr, s.enabled, s.created_at, s.created_at);
            }
            console.log(`[DB] Migrated ${existingSchedules.length} scheduled_tasks → todos_v2`);
        }
    } catch { /* table may not exist or already migrated */ }

    // Migrate old todos → todos_v2
    try {
        const existingTodos = db.prepare(
            `SELECT id, tenant_key, content, status, priority, remind_at, created_at, updated_at FROM todos`
        ).all() as any[];
        if (existingTodos.length > 0) {
            const insert = db.prepare(
                `INSERT OR IGNORE INTO todos_v2 (id, scope_key, content, status, priority, fire_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const t of existingTodos) {
                const fireAt = t.remind_at ? new Date(t.remind_at).getTime() : null;
                const createdTs = typeof t.created_at === 'string' ? new Date(t.created_at).getTime() : t.created_at;
                const updatedTs = typeof t.updated_at === 'string' ? new Date(t.updated_at).getTime() : t.updated_at;
                // Map old statuses: not-started → pending, completed → done
                let status = t.status;
                if (status === 'not-started') status = 'pending';
                else if (status === 'completed') status = 'done';
                insert.run(t.id, t.tenant_key, t.content, status, t.priority ?? null, fireAt, createdTs, updatedTs);
            }
            console.log(`[DB] Migrated ${existingTodos.length} todos → todos_v2`);
        }
    } catch { /* table may not exist or already migrated */ }
}
