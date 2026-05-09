/**
 * trash-service.ts — Soft-delete trash bin for articles, sessions, and notebooks.
 *
 * Storage layout inside stateDir:
 *   trash/manifest.json               — list of trashed items
 *   trash/articles/{trashId}.md       — trashed article content
 *   trash/notebooks/{trashId}/        — trashed notebook content dir
 *   trash/notebooks/{trashId}.meta/   — trashed notebook stateDir metadata
 *
 * Sessions are soft-deleted in place via chat-service (is_deleted flag).
 *
 * Items are auto-expired after TRASH_TTL_MS (30 days).
 */
import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import { parseJsonOr } from '../utils/json.js';

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrashItem {
    id: string;
    type: 'article' | 'session' | 'notebook';
    title: string;
    deletedAt: number;
    /** For 'article': original relative path from workDir */
    originalPath?: string;
    /** For 'article' / 'notebook': notebook name */
    notebook?: string;
    /** For 'session': session id */
    sessionId?: string;
}

interface TrashManifest {
    items: TrashItem[];
}

// ── Path helpers ─────────────────────────────────────────────────────────────

function trashDir(stateDir: string): string {
    return join(stateDir, 'trash');
}

function manifestPath(stateDir: string): string {
    return join(trashDir(stateDir), 'manifest.json');
}

function articleTrashPath(stateDir: string, trashId: string): string {
    return join(trashDir(stateDir), 'articles', `${trashId}.md`);
}

function notebookContentTrashPath(stateDir: string, trashId: string): string {
    return join(trashDir(stateDir), 'notebooks', trashId);
}

function notebookMetaTrashPath(stateDir: string, trashId: string): string {
    return join(trashDir(stateDir), 'notebooks', `${trashId}.meta`);
}

// ── Manifest helpers ─────────────────────────────────────────────────────────

async function readManifest(stateDir: string): Promise<TrashManifest> {
    try {
        const raw = await fs.readFile(manifestPath(stateDir), 'utf8');
        return parseJsonOr<TrashManifest>(raw, { items: [] });
    } catch {
        return { items: [] };
    }
}

async function writeManifest(stateDir: string, manifest: TrashManifest): Promise<void> {
    mkdirSync(trashDir(stateDir), { recursive: true });
    await fs.writeFile(manifestPath(stateDir), JSON.stringify(manifest, null, 2), 'utf8');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Move a notebook article (.md) into the trash.
 * Returns the new trash item, or null if the file doesn't exist.
 */
export async function trashArticle(
    workDir: string,
    stateDir: string,
    entryId: string,
    title: string,
): Promise<TrashItem | null> {
    const srcPath = join(workDir, entryId);
    // Security: ensure entryId stays within workDir
    if (!resolve(srcPath).startsWith(resolve(workDir) + '/')) return null;
    if (!existsSync(srcPath)) return null;

    const trashId = generateId();
    const destPath = articleTrashPath(stateDir, trashId);
    mkdirSync(join(trashDir(stateDir), 'articles'), { recursive: true });

    await fs.copyFile(srcPath, destPath);
    await fs.unlink(srcPath);

    const manifest = await readManifest(stateDir);
    const now = Date.now();
    const item: TrashItem = {
        id: trashId,
        type: 'article',
        title,
        deletedAt: now,
        originalPath: entryId,
        notebook: entryId.split('/')[1] ?? undefined,
    };
    manifest.items.push(item);
    await writeManifest(stateDir, manifest);
    return item;
}

/**
 * Move an entire notebook directory into the trash.
 * Returns the new trash item, or null if the notebook doesn't exist.
 */
export async function trashNotebook(
    workDir: string,
    stateDir: string,
    name: string,
): Promise<TrashItem | null> {
    if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\')) return null;
    const contentDir = join(workDir, 'notebooks', name);
    if (!existsSync(contentDir)) return null;

    const trashId = generateId();
    mkdirSync(join(trashDir(stateDir), 'notebooks'), { recursive: true });

    // Move content dir
    await fs.rename(contentDir, notebookContentTrashPath(stateDir, trashId));

    // Move meta dir if it exists
    const metaDir = join(stateDir, 'notebooks', name);
    if (existsSync(metaDir)) {
        await fs.rename(metaDir, notebookMetaTrashPath(stateDir, trashId));
    }

    const manifest = await readManifest(stateDir);
    const item: TrashItem = {
        id: trashId,
        type: 'notebook',
        title: name,
        deletedAt: Date.now(),
        notebook: name,
    };
    manifest.items.push(item);
    await writeManifest(stateDir, manifest);
    return item;
}

/**
 * Register a session trash entry (called after chat-service marks it deleted).
 */
export async function trashRegisterSession(
    stateDir: string,
    sessionId: string,
    title: string,
): Promise<TrashItem> {
    const manifest = await readManifest(stateDir);
    const trashId = generateId();
    const item: TrashItem = {
        id: trashId,
        type: 'session',
        title,
        deletedAt: Date.now(),
        sessionId,
    };
    manifest.items.push(item);
    await writeManifest(stateDir, manifest);
    return item;
}

/** List all non-expired trash items. Also prunes expired entries. */
export async function trashList(stateDir: string): Promise<TrashItem[]> {
    const manifest = await readManifest(stateDir);
    const cutoff = Date.now() - TRASH_TTL_MS;
    const expired = manifest.items.filter((i) => i.deletedAt < cutoff);
    const active = manifest.items.filter((i) => i.deletedAt >= cutoff);

    if (expired.length > 0) {
        // Clean up expired items in background
        for (const item of expired) {
            await _permanentDeleteItem(stateDir, item).catch(() => {});
        }
        manifest.items = active;
        await writeManifest(stateDir, manifest);
    }

    return active.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Restore a trash item to its original location. */
export async function trashRestore(
    workDir: string,
    stateDir: string,
    trashId: string,
): Promise<boolean> {
    const manifest = await readManifest(stateDir);
    const idx = manifest.items.findIndex((i) => i.id === trashId);
    if (idx === -1) return false;
    const item = manifest.items[idx];

    try {
        if (item.type === 'article') {
            await _restoreArticle(workDir, stateDir, item);
        } else if (item.type === 'notebook') {
            await _restoreNotebook(workDir, stateDir, item);
        }
        // Sessions are restored by chat-service (clear is_deleted flag)
        // The manifest entry is removed in all cases
        manifest.items.splice(idx, 1);
        await writeManifest(stateDir, manifest);
        return true;
    } catch {
        return false;
    }
}

async function _restoreArticle(workDir: string, stateDir: string, item: TrashItem): Promise<void> {
    if (!item.originalPath) throw new Error('No originalPath');
    const srcPath = articleTrashPath(stateDir, item.id);
    const destPath = join(workDir, item.originalPath);
    // Ensure destination directory exists
    mkdirSync(join(destPath, '..'), { recursive: true });
    // If a file already exists at destination, use a new name to avoid conflict
    const finalDest = existsSync(destPath) ? destPath.replace(/\.md$/, `_restored_${Date.now()}.md`) : destPath;
    await fs.copyFile(srcPath, finalDest);
    await fs.unlink(srcPath);
}

async function _restoreNotebook(workDir: string, stateDir: string, item: TrashItem): Promise<void> {
    if (!item.notebook) throw new Error('No notebook name');
    const contentDest = join(workDir, 'notebooks', item.notebook);
    const contentSrc = notebookContentTrashPath(stateDir, item.id);
    const metaSrc = notebookMetaTrashPath(stateDir, item.id);
    const metaDest = join(stateDir, 'notebooks', item.notebook);

    // If destination already exists, pick a new name
    const name = existsSync(contentDest) ? `${item.notebook}_restored_${Date.now()}` : item.notebook;
    mkdirSync(join(workDir, 'notebooks'), { recursive: true });
    await fs.rename(contentSrc, join(workDir, 'notebooks', name));
    if (existsSync(metaSrc)) {
        mkdirSync(join(stateDir, 'notebooks'), { recursive: true });
        await fs.rename(metaSrc, existsSync(metaDest) ? `${metaDest}_restored_${Date.now()}` : metaDest);
    }
}

/** Permanently delete one trash item. */
export async function trashPermanentDelete(
    stateDir: string,
    trashId: string,
): Promise<boolean> {
    const manifest = await readManifest(stateDir);
    const idx = manifest.items.findIndex((i) => i.id === trashId);
    if (idx === -1) return false;
    const item = manifest.items[idx];
    await _permanentDeleteItem(stateDir, item).catch(() => {});
    manifest.items.splice(idx, 1);
    await writeManifest(stateDir, manifest);
    return true;
}

/** Permanently delete all items in trash. */
export async function trashEmpty(stateDir: string): Promise<number> {
    const manifest = await readManifest(stateDir);
    let count = 0;
    for (const item of manifest.items) {
        await _permanentDeleteItem(stateDir, item).catch(() => {});
        count++;
    }
    manifest.items = [];
    await writeManifest(stateDir, manifest);
    return count;
}

async function _permanentDeleteItem(stateDir: string, item: TrashItem): Promise<void> {
    if (item.type === 'article') {
        const p = articleTrashPath(stateDir, item.id);
        await fs.unlink(p).catch(() => {});
    } else if (item.type === 'notebook') {
        const contentPath = notebookContentTrashPath(stateDir, item.id);
        const metaPath = notebookMetaTrashPath(stateDir, item.id);
        await fs.rm(contentPath, { recursive: true, force: true }).catch(() => {});
        await fs.rm(metaPath, { recursive: true, force: true }).catch(() => {});
    }
    // Sessions: the actual cleanup is done in chat-service; here we just remove the manifest entry
}

/** Remove a trash entry by sessionId (called when session is hard-restored). */
export async function trashRemoveSessionEntry(
    stateDir: string,
    sessionId: string,
): Promise<void> {
    const manifest = await readManifest(stateDir);
    manifest.items = manifest.items.filter((i) => !(i.type === 'session' && i.sessionId === sessionId));
    await writeManifest(stateDir, manifest);
}
