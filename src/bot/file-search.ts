import { promises as fs } from 'fs';
import { join } from 'path';

export async function findFiles(query: string, baseDir: string, resolvedBase: string, depth = 0): Promise<string[]> {
    const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp', '__pycache__', 'dist', '.cache']);
    const MAX_DEPTH = 6;
    const results: string[] = [];
    if (depth > MAX_DEPTH) return results;

    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch {
        return results;
    }

    const q = query.toLowerCase();
    for (const entry of entries) {
        const absPath = join(baseDir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
            const sub = await findFiles(query, absPath, resolvedBase, depth + 1);
            results.push(...sub);
        } else if (entry.isFile()) {
            const relPath = absPath.slice(resolvedBase.length + 1);
            if (relPath.toLowerCase().includes(q)) {
                results.push(absPath);
            }
        }
    }

    const basename = query.toLowerCase();
    results.sort((a, b) => {
        const aName = a.split('/').pop()!.toLowerCase();
        const bName = b.split('/').pop()!.toLowerCase();
        const aExact = aName.includes(basename) ? 0 : 1;
        const bExact = bName.includes(basename) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.length - b.length;
    });
    return results;
}
