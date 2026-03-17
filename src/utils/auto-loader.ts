/**
 * auto-loader.ts — Generic directory scanner for auto-registering modules.
 *
 * Scans a directory for .ts/.js files, dynamically imports each, and
 * collects exported values that match a given predicate.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Files that are never auto-loaded. */
const SKIP = new Set(['index.ts', 'index.js']);

function shouldSkip(name: string): boolean {
    return SKIP.has(name) || name.startsWith('_');
}

/**
 * Scan `dir` for module files, import each, and return all exported values
 * that pass the `predicate` check.
 *
 * @param dir      Absolute path to the directory to scan.
 * @param predicate A type-guard function that identifies the exports we want.
 */
export async function autoLoad<T>(
    dir: string,
    predicate: (value: unknown) => value is T,
): Promise<T[]> {
    const entries = await readdir(dir);
    const modules = entries.filter(
        f => (f.endsWith('.ts') || f.endsWith('.js')) && !shouldSkip(f),
    );

    const results: T[] = [];

    for (const file of modules) {
        const filePath = join(dir, file);
        const mod = await import(pathToFileURL(filePath).href);
        for (const value of Object.values(mod)) {
            if (predicate(value)) {
                results.push(value);
            }
        }
    }

    return results;
}
