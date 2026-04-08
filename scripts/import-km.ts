/**
 * scripts/import-km.ts — One-time migration: import xifeng-km markdown files into notebook_entries.
 *
 * Usage:
 *   npx tsx scripts/import-km.ts [--km-dir <path>] [--db <path>] [--dry-run]
 *
 * Defaults:
 *   --km-dir  ./resource/km/xifeng-km
 *   --db      ./data/neo.db
 */

import Database from 'better-sqlite3';
import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY_RUN  = args.includes('--dry-run');
const KM_DIR   = resolve(getArg('--km-dir', './resource/km/xifeng-km'));
const DB_PATH  = resolve(getArg('--db', './data/neo.db'));

// ── File name parser ──────────────────────────────────────────────────────────
/**
 * Parse filename like "007_字越少，事越大22_3_9.md"
 * Returns { title, date } or { title, date: null } if date not found.
 */
function parseFilename(filename: string): { title: string; date: string | null } {
    // Remove .md extension
    const base = filename.replace(/\.md$/i, '');

    // Remove leading numeric prefix: "007_" or "007 "
    const withoutPrefix = base.replace(/^\d+[_\s]/, '');

    // Try to extract trailing date pattern: YY_M_D or YY_MM_DD
    // e.g. "22_3_9" "25_1_2" "23_12_27"
    const dateMatch = withoutPrefix.match(/(\d{2}_\d{1,2}_\d{1,2})$/);
    if (dateMatch) {
        const datePart = dateMatch[1];
        const title = withoutPrefix.slice(0, withoutPrefix.length - datePart.length).replace(/[\s_]+$/, '');
        const [yy, mm, dd] = datePart.split('_').map(Number);
        const year = yy < 30 ? 2000 + yy : 1900 + yy;
        const date = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        return { title: title || base, date };
    }

    return { title: withoutPrefix || base, date: null };
}

// ── DB setup ──────────────────────────────────────────────────────────────────
function openDb(path: string): Database.Database {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
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
    `);
    return db;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`[import-km] KM dir : ${KM_DIR}`);
    console.log(`[import-km] DB     : ${DB_PATH}`);
    console.log(`[import-km] Dry run: ${DRY_RUN}`);
    console.log('');

    const files = (await readdir(KM_DIR))
        .filter(f => f.endsWith('.md') && !f.startsWith('00_'))
        .sort();

    console.log(`[import-km] Found ${files.length} articles to import.\n`);

    const db = DRY_RUN ? null : openDb(DB_PATH);
    const insert = db?.prepare(`
        INSERT OR IGNORE INTO notebook_entries
            (title, author, date, source, summary, tags, content, created_at, updated_at)
        VALUES
            (@title, @author, @date, @source, @summary, @tags, @content, @created_at, @updated_at)
    `);

    // Check existing titles to skip duplicates
    const existingTitles = DRY_RUN
        ? new Set<string>()
        : new Set<string>(
              (db!.prepare('SELECT title FROM notebook_entries').all() as { title: string }[])
                  .map(r => r.title)
          );

    const now = new Date().toISOString();
    let imported = 0;
    let skipped = 0;

    for (const fname of files) {
        const { title, date } = parseFilename(fname);

        if (existingTitles.has(title)) {
            console.log(`  SKIP (exists) : ${title}`);
            skipped++;
            continue;
        }

        const content = await readFile(join(KM_DIR, fname), 'utf8');

        const row = {
            title,
            author:     '西风',
            date:       date ?? null,
            source:     '西风知识库',
            summary:    null,
            tags:       null,
            content,
            created_at: now,
            updated_at: now,
        };

        if (DRY_RUN) {
            console.log(`  DRY  : [${date ?? '?'}] ${title}`);
        } else {
            insert!.run(row);
            console.log(`  OK   : [${date ?? '?'}] ${title}`);
        }
        imported++;
    }

    console.log(`\n[import-km] Done. imported=${imported}, skipped=${skipped}`);
    db?.close();
}

main().catch(err => {
    console.error('[import-km] Fatal:', err);
    process.exit(1);
});
