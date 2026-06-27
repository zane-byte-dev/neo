/**
 * project-registry.ts — User-level "recent project directories" list.
 *
 * Stores a small registry of absolute directory paths the user has used
 * as a per-session project root override. The list is purely a UX
 * convenience (recent-used picker); the actual binding is held on
 * `SessionRow.project_root`.
 *
 * Storage: {stateDir}/projects.json
 *   { recent: [{ id, name, path, lastUsedAt }] }
 */

import { promises as fs } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import { parseJsonOr } from '../utils/json.js';
import { userGetStateDir } from './user-service.js';

export interface ProjectEntry {
    id: string;
    name: string;
    path: string;
    lastUsedAt: string;
}

interface ProjectStore {
    recent: ProjectEntry[];
}

function storeFile(userId: string): string {
    const stateDir = userGetStateDir(userId);
    if (!stateDir) throw new Error(`No stateDir configured for user "${userId}"`);
    return join(stateDir, 'projects.json');
}

async function readStore(userId: string): Promise<ProjectStore> {
    try {
        const raw = await fs.readFile(storeFile(userId), 'utf8');
        return parseJsonOr<ProjectStore>(raw, { recent: [] });
    } catch {
        return { recent: [] };
    }
}

async function writeStore(userId: string, store: ProjectStore): Promise<void> {
    await fs.writeFile(storeFile(userId), JSON.stringify(store, null, 2), 'utf8');
}

export async function listProjects(userId: string): Promise<ProjectEntry[]> {
    const store = await readStore(userId);
    return [...store.recent].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

async function validatePath(rawPath: string): Promise<string> {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
        throw new Error('path is required');
    }
    const abs = resolve(rawPath.trim());
    let stat;
    try {
        stat = await fs.stat(abs);
    } catch {
        throw new Error(`Path does not exist: ${abs}`);
    }
    if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${abs}`);
    return abs;
}

export async function registerProject(
    userId: string,
    input: { path: string; name?: string },
): Promise<ProjectEntry> {
    const abs = await validatePath(input.path);
    const store = await readStore(userId);
    const existing = store.recent.find((p) => p.path === abs);
    const now = new Date().toISOString();
    if (existing) {
        existing.lastUsedAt = now;
        if (input.name?.trim()) existing.name = input.name.trim();
        await writeStore(userId, store);
        return existing;
    }
    const entry: ProjectEntry = {
        id: generateId(),
        name: input.name?.trim() || basename(abs),
        path: abs,
        lastUsedAt: now,
    };
    store.recent.push(entry);
    await writeStore(userId, store);
    return entry;
}

export async function removeProject(userId: string, id: string): Promise<boolean> {
    const store = await readStore(userId);
    const idx = store.recent.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    store.recent.splice(idx, 1);
    await writeStore(userId, store);
    return true;
}

/** Bump `lastUsedAt` for the entry matching `path`. Silently no-ops if not found. */
export async function touchProject(userId: string, path: string): Promise<void> {
    const abs = resolve(path);
    const store = await readStore(userId);
    const entry = store.recent.find((p) => p.path === abs);
    if (!entry) return;
    entry.lastUsedAt = new Date().toISOString();
    await writeStore(userId, store);
}
