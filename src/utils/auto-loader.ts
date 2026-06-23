/**
 * auto-loader.ts — Generic directory scanner for auto-registering modules.
 *
 * Recursively scans a directory (and subdirectories) for .ts/.js files,
 * dynamically imports each, and collects exported values that match a
 * given predicate.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from './logger.js';

/** Files that are never auto-loaded. */
const SKIP = new Set(['index.ts', 'index.js']);

function shouldSkip(name: string): boolean {
    return SKIP.has(name) || name.startsWith('_');
}

const MAX_DEPTH = 10;

/**
 * Scan `dir` (and subdirectories) for module files, import each, and return
 * all exported values that pass the `predicate` check.
 *
 * @param dir      Absolute path to the directory to scan.
 * @param predicate A type-guard function that identifies the exports we want.
 * @param depth    Current recursion depth (internal, do not set manually).
 */
export async function autoLoad<T>(
    dir: string,
    predicate: (value: unknown) => value is T,
    depth = 0,
): Promise<T[]> {
    if (depth >= MAX_DEPTH) {
        log.warn('autoLoad', `Max recursion depth (${MAX_DEPTH}) reached at: ${dir}`);
        return [];
    }

    const entries = await readdir(dir, { withFileTypes: true });
    const results: T[] = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            // Recurse into subdirectories (skip _ prefixed dirs)
            if (!entry.name.startsWith('_') && entry.name !== '__tests__') {
                const subResults = await autoLoad(join(dir, entry.name), predicate, depth + 1);
                results.push(...subResults);
            }
            continue;
        }

        const name = entry.name;
        if (!(name.endsWith('.ts') || name.endsWith('.js')) || shouldSkip(name)) continue;
        if (name.includes('.test.') || name.includes('.spec.')) continue;

        const filePath = join(dir, name);
        const mod = await import(pathToFileURL(filePath).href);
        for (const value of Object.values(mod)) {
            if (predicate(value)) {
                results.push(value);
            }
        }
    }

    return results;
}
