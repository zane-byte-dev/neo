/**
 * project-registry.test.ts — recent project list persistence
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_USER = 'projreg-user';
const ORIGINAL_USERS_ENV = process.env.USERS;
let stateDir: string;
let extProject: string;

let listProjects: typeof import('../project-registry.js').listProjects;
let registerProject: typeof import('../project-registry.js').registerProject;
let removeProject: typeof import('../project-registry.js').removeProject;
let touchProject: typeof import('../project-registry.js').touchProject;

beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'projreg-state-'));
    extProject = mkdtempSync(join(tmpdir(), 'projreg-ext-'));
    process.env.USERS = JSON.stringify([
        { id: TEST_USER, name: 'T', workDir: stateDir, stateDir },
    ]);
    const mod = await import('../project-registry.js');
    listProjects = mod.listProjects;
    registerProject = mod.registerProject;
    removeProject = mod.removeProject;
    touchProject = mod.touchProject;
});

afterEach(async () => {
    if (ORIGINAL_USERS_ENV === undefined) delete process.env.USERS;
    else process.env.USERS = ORIGINAL_USERS_ENV;
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(extProject, { recursive: true, force: true }).catch(() => {});
});

describe('project-registry', () => {
    it('starts empty', async () => {
        expect(await listProjects(TEST_USER)).toEqual([]);
    });

    it('register persists an absolute path', async () => {
        const entry = await registerProject(TEST_USER, { path: extProject, name: 'External' });
        expect(entry.path).toBe(extProject);
        expect(entry.name).toBe('External');
        const list = await listProjects(TEST_USER);
        expect(list).toHaveLength(1);
        expect(list[0]!.path).toBe(extProject);
    });

    it('register de-dupes by resolved path', async () => {
        await registerProject(TEST_USER, { path: extProject });
        await registerProject(TEST_USER, { path: extProject + '/.' });
        const list = await listProjects(TEST_USER);
        expect(list).toHaveLength(1);
    });

    it('register rejects missing path', async () => {
        await expect(registerProject(TEST_USER, { path: '/no/such/dir-xyz-123' })).rejects.toThrow();
    });

    it('register rejects file (not directory)', async () => {
        const filePath = join(extProject, 'file.txt');
        await fs.writeFile(filePath, 'x');
        await expect(registerProject(TEST_USER, { path: filePath })).rejects.toThrow(/not a directory/);
    });

    it('removeProject deletes the entry', async () => {
        const entry = await registerProject(TEST_USER, { path: extProject });
        expect(await removeProject(TEST_USER, entry.id)).toBe(true);
        expect(await listProjects(TEST_USER)).toEqual([]);
        expect(await removeProject(TEST_USER, entry.id)).toBe(false);
    });

    it('touchProject bumps lastUsedAt', async () => {
        const entry = await registerProject(TEST_USER, { path: extProject });
        const before = entry.lastUsedAt;
        await new Promise((r) => setTimeout(r, 10));
        await touchProject(TEST_USER, extProject);
        const list = await listProjects(TEST_USER);
        expect(list[0]!.lastUsedAt > before).toBe(true);
    });

    it('defaults name to basename when omitted', async () => {
        const sub = join(extProject, 'inner');
        mkdirSync(sub);
        const entry = await registerProject(TEST_USER, { path: sub });
        expect(entry.name).toBe('inner');
    });
});
