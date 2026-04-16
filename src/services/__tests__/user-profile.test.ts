import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { UserProfileManager } from '../user-profile.js';

let workDir: string;

beforeEach(async () => {
    workDir = join(tmpdir(), `neo-test-profile-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(workDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('UserProfileManager', () => {
    describe('init', () => {
        it('creates USER.md with default template when missing', async () => {
            const mgr = new UserProfileManager(workDir);
            await mgr.init();

            const content = await fs.readFile(join(workDir, 'USER.md'), 'utf8');
            expect(content).toContain('用户档案');
            expect(content).toContain('姓名');
        });

        it('does not overwrite existing USER.md', async () => {
            const existingContent = '# My Profile\n\nCustom content.';
            await fs.writeFile(join(workDir, 'USER.md'), existingContent, 'utf8');

            const mgr = new UserProfileManager(workDir);
            await mgr.init();

            const content = await fs.readFile(join(workDir, 'USER.md'), 'utf8');
            expect(content).toBe(existingContent);
        });
    });

    describe('read', () => {
        it('reads existing USER.md content', async () => {
            const expected = '# Test Profile\nSome data';
            await fs.writeFile(join(workDir, 'USER.md'), expected, 'utf8');

            const mgr = new UserProfileManager(workDir);
            expect(await mgr.read()).toBe(expected);
        });

        it('returns empty string when file does not exist', async () => {
            const mgr = new UserProfileManager(workDir);
            expect(await mgr.read()).toBe('');
        });
    });

    describe('write', () => {
        it('writes new content to USER.md', async () => {
            const mgr = new UserProfileManager(workDir);
            await mgr.write('New profile content');

            const content = await fs.readFile(join(workDir, 'USER.md'), 'utf8');
            expect(content).toBe('New profile content');
        });

        it('overwrites existing content', async () => {
            await fs.writeFile(join(workDir, 'USER.md'), 'old', 'utf8');

            const mgr = new UserProfileManager(workDir);
            await mgr.write('new');

            const content = await fs.readFile(join(workDir, 'USER.md'), 'utf8');
            expect(content).toBe('new');
        });
    });

    describe('toContextString', () => {
        it('returns formatted context when profile has content', async () => {
            await fs.writeFile(join(workDir, 'USER.md'), '- Name: Neo', 'utf8');

            const mgr = new UserProfileManager(workDir);
            const result = await mgr.toContextString();
            expect(result).toBe('[用户档案]\n- Name: Neo');
        });

        it('returns empty string when profile is empty', async () => {
            const mgr = new UserProfileManager(workDir);
            const result = await mgr.toContextString();
            expect(result).toBe('');
        });

        it('returns empty string when profile is whitespace only', async () => {
            await fs.writeFile(join(workDir, 'USER.md'), '   \n  ', 'utf8');

            const mgr = new UserProfileManager(workDir);
            const result = await mgr.toContextString();
            expect(result).toBe('');
        });
    });

    describe('toDisplayString', () => {
        it('returns content when profile has data', async () => {
            await fs.writeFile(join(workDir, 'USER.md'), '- Name: Neo', 'utf8');

            const mgr = new UserProfileManager(workDir);
            const result = await mgr.toDisplayString();
            expect(result).toBe('- Name: Neo');
        });

        it('returns placeholder message when profile is empty', async () => {
            const mgr = new UserProfileManager(workDir);
            const result = await mgr.toDisplayString();
            expect(result).toContain('暂无个人信息');
        });
    });
});
