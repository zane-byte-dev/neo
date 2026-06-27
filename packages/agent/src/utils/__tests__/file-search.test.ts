import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expandBraces, matchesGlob, walkDirEntries } from '../file-search.js';

const tempDirs: string[] = [];

async function collectWalkEntries(root: string, maxDepth?: number): Promise<string[]> {
    const entries: string[] = [];
    for await (const entry of walkDirEntries(root, { maxDepth })) {
        entries.push(entry.relPath);
    }
    return entries.sort();
}

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'neo-file-search-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('expandBraces', () => {
    it('expands nested brace alternatives recursively', () => {
        expect(expandBraces('src/*.{ts,tsx}')).toEqual(['src/*.ts', 'src/*.tsx']);
        expect(expandBraces('a{b,c{d,e}}')).toEqual(['ab', 'acd', 'ace']);
    });
});

describe('matchesGlob', () => {
    it('matches brace patterns and normalizes path separators', () => {
        expect(matchesGlob('src/utils/test.ts', 'src/**/*.{ts,tsx}')).toBe(true);
        expect(matchesGlob('src\\utils\\test.ts', 'src/**/*.ts')).toBe(true);
        expect(matchesGlob('src/utils/test.js', 'src/**/*.{ts,tsx}')).toBe(false);
    });

    it('supports matchAnywhere mode for filename-oriented filters', () => {
        expect(matchesGlob('src/utils/file-search.ts', '*.ts', { matchAnywhere: true })).toBe(true);
        expect(matchesGlob('src/utils/file-search.ts', '*.md', { matchAnywhere: true })).toBe(false);
    });
});

describe('walkDirEntries', () => {
    it('skips configured directories and nested hidden entries', async () => {
        const root = await makeTempDir();
        await mkdir(join(root, 'src', '.cache'), { recursive: true });
        await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
        await writeFile(join(root, 'src', 'keep.ts'), 'export const keep = true;');
        await writeFile(join(root, 'src', '.cache', 'ignored.ts'), 'ignored');
        await writeFile(join(root, 'node_modules', 'pkg', 'ignored.js'), 'ignored');

        const entries = await collectWalkEntries(root);
        expect(entries).toContain('src');
        expect(entries).toContain('src/keep.ts');
        expect(entries).not.toContain('src/.cache');
        expect(entries).not.toContain('node_modules');
    });

    it('honors maxDepth when recursing', async () => {
        const root = await makeTempDir();
        await mkdir(join(root, 'a', 'b'), { recursive: true });
        await writeFile(join(root, 'a', 'top.txt'), 'top');
        await writeFile(join(root, 'a', 'b', 'deep.txt'), 'deep');

        const entries = await collectWalkEntries(root, 1);
        expect(entries).toContain('a');
        expect(entries).toContain('a/top.txt');
        expect(entries).not.toContain('a/b/deep.txt');
    });
});