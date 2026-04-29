/**
 * Tests for refresh-now public entry point.
 * The internal LLM call is mocked end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userListMock = vi.fn();
const generateTextMock = vi.fn();

vi.mock('../user-service.js', () => ({
    userList: userListMock,
}));

vi.mock('ai', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('ai');
    return { ...actual, generateText: generateTextMock };
});

vi.mock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: () => () => ({}),
}));

let tmp: string;

beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'rfn-'));
    userListMock.mockReturnValue([{ id: 'u1', stateDir: tmp, workDir: tmp }]);
    generateTextMock.mockResolvedValue({ text: '# Mission\nstay focused\n\n# Status\nProgressing.' });
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('refreshNowForAllUsers', () => {
    it('skips when GEMINI_API_KEY is missing', async () => {
        vi.doMock('../../config.js', async () => {
            const actual = await vi.importActual<Record<string, unknown>>('../../config.js');
            return { ...actual, getGeminiApiKey: () => '' };
        });
        const { refreshNowForAllUsers } = await import('../refresh-now.js');
        await expect(refreshNowForAllUsers()).resolves.toBeUndefined();
        expect(generateTextMock).not.toHaveBeenCalled();
        vi.doUnmock('../../config.js');
    });

    it('writes a refreshed NOW.md when daily logs exist', async () => {
        vi.doMock('../../config.js', async () => {
            const actual = await vi.importActual<Record<string, unknown>>('../../config.js');
            return { ...actual, getGeminiApiKey: () => 'fake-key' };
        });
        // Add a daily log for today
        const dailyDir = join(tmp, 'memory', '1-Daily');
        await fs.mkdir(dailyDir, { recursive: true });
        const today = new Date().toISOString().slice(0, 10);
        await fs.writeFile(join(dailyDir, `${today}.md`), '- worked on neo', 'utf8');
        // pre-existing NOW.md (optional)
        await fs.writeFile(join(tmp, 'memory', 'NOW.md'), '# Mission\nold\n', 'utf8');

        vi.resetModules();
        const { refreshNowForAllUsers } = await import('../refresh-now.js');
        await refreshNowForAllUsers();

        expect(generateTextMock).toHaveBeenCalled();
        const out = await fs.readFile(join(tmp, 'memory', 'NOW.md'), 'utf8');
        expect(out).toContain('Mission');
        expect(out).toContain('Auto-refreshed');
        vi.doUnmock('../../config.js');
    });

    it('continues when refreshUser throws for one user', async () => {
        vi.doMock('../../config.js', async () => {
            const actual = await vi.importActual<Record<string, unknown>>('../../config.js');
            return { ...actual, getGeminiApiKey: () => 'fake-key' };
        });
        userListMock.mockReturnValue([
            { id: 'u-bad', stateDir: '/path/that/does/not/exist/never', workDir: '/path/that/does/not/exist/never' },
            { id: 'u1', stateDir: tmp, workDir: tmp },
        ]);
        const dailyDir = join(tmp, 'memory', '1-Daily');
        await fs.mkdir(dailyDir, { recursive: true });
        const today = new Date().toISOString().slice(0, 10);
        await fs.writeFile(join(dailyDir, `${today}.md`), '- progress', 'utf8');

        vi.resetModules();
        const { refreshNowForAllUsers } = await import('../refresh-now.js');
        await expect(refreshNowForAllUsers()).resolves.toBeUndefined();
        // u1 should still get NOW.md
        const out = await fs.readFile(join(tmp, 'memory', 'NOW.md'), 'utf8').catch(() => '');
        expect(out).toContain('Mission');
        vi.doUnmock('../../config.js');
    });
});
