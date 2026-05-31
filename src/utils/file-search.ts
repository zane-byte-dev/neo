import { promises as fs } from 'fs';
import { join } from 'path';

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', 'cache', '__pycache__', '.next']);

export interface WalkEntry {
    fullPath: string;
    relPath: string;
    name: string;
    isDirectory: boolean;
    isFile: boolean;
}

interface WalkDirOptions {
    maxDepth?: number;
    skipDirs?: ReadonlySet<string>;
}

function normalizePathForGlob(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

export async function* walkDirEntries(
    root: string,
    options: WalkDirOptions = {},
    dir = root,
    depth = 0,
): AsyncGenerator<WalkEntry> {
    const maxDepth = options.maxDepth ?? 15;
    const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
    if (depth > maxDepth) return;

    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.name.startsWith('.') && depth > 0) continue;
        if (skipDirs.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        const relPath = fullPath.slice(root.length + 1);
        const walkEntry: WalkEntry = {
            fullPath,
            relPath,
            name: entry.name,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
        };
        yield walkEntry;

        if (walkEntry.isDirectory) {
            yield* walkDirEntries(root, options, fullPath, depth + 1);
        }
    }
}

export function expandBraces(pattern: string): string[] {
    const openIndex = pattern.indexOf('{');
    if (openIndex === -1) return [pattern];

    let closeIndex = -1;
    let depth = 0;
    for (let i = openIndex; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '{') depth++;
        if (char === '}') {
            depth--;
            if (depth === 0) {
                closeIndex = i;
                break;
            }
        }
    }
    if (closeIndex === -1) return [pattern];

    const prefix = pattern.slice(0, openIndex);
    const body = pattern.slice(openIndex + 1, closeIndex);
    const suffix = pattern.slice(closeIndex + 1);

    const alternatives: string[] = [];
    depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (char === '{') depth++;
        if (char === '}') depth--;
        if (char === ',' && depth === 0) {
            alternatives.push(body.slice(start, i));
            start = i + 1;
        }
    }
    alternatives.push(body.slice(start));

    return alternatives.flatMap((alt) => expandBraces(prefix + alt + suffix));
}

function globToRegex(pattern: string, options: { matchAnywhere?: boolean } = {}): RegExp {
    const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\x00')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\x00/g, '.*');

    const prefix = options.matchAnywhere ? '(^|/)' : '^';
    return new RegExp(`${prefix}${regexStr}$`);
}

export function matchesGlob(filePath: string, pattern: string, options: { matchAnywhere?: boolean } = {}): boolean {
    try {
        const normalized = normalizePathForGlob(filePath);
        return expandBraces(pattern).some((entry) => globToRegex(entry, options).test(normalized));
    } catch {
        return false;
    }
}