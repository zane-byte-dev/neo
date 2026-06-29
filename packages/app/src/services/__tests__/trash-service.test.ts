import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trashArticle } from '../trash-service.js';

let root: string;
let workDir: string;
let stateDir: string;

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'trash-service-'));
    workDir = join(root, 'work');
    stateDir = join(root, 'state');
    await fs.mkdir(join(workDir, 'notebooks', 'nb'), { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('trash service', () => {
    it('moves an article to trash and records it in the manifest', async () => {
        const entryId = 'notebooks/nb/source.md';
        await fs.writeFile(join(workDir, entryId), '# Source', 'utf8');

        const item = await trashArticle(workDir, stateDir, entryId, 'Source');

        expect(item).toEqual(expect.objectContaining({ type: 'article', title: 'Source', originalPath: entryId }));
        await expect(fs.readFile(join(workDir, entryId), 'utf8')).rejects.toThrow();
        const manifest = JSON.parse(await fs.readFile(join(stateDir, 'trash', 'manifest.json'), 'utf8'));
        expect(manifest.items[0]).toEqual(expect.objectContaining({ id: item!.id, title: 'Source' }));
    });

    it('blocks article paths outside the workspace', async () => {
        const sibling = join(root, 'work-sibling');
        await fs.mkdir(sibling, { recursive: true });
        const outside = join(sibling, 'source.md');
        await fs.writeFile(outside, 'secret', 'utf8');

        const item = await trashArticle(workDir, stateDir, '../work-sibling/source.md', 'Secret');

        expect(item).toBeNull();
        expect(await fs.readFile(outside, 'utf8')).toBe('secret');
    });
});
