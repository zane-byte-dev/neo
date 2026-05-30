import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUserPreferences, saveUserPreferences } from '../user-prefs.js';

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prefs-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('loadUserPreferences', () => {
    it('returns {} when file is missing', async () => {
        expect(await loadUserPreferences(dir)).toEqual({});
    });

    it('returns {} for invalid JSON', async () => {
        await fs.writeFile(join(dir, 'preferences.json'), 'not json', 'utf8');
        expect(await loadUserPreferences(dir)).toEqual({});
    });

    it('sanitizes loaded preferences', async () => {
        await fs.writeFile(
            join(dir, 'preferences.json'),
            JSON.stringify({
                defaultModel: '  deepseek  ',
                enabledModels: ['deepseek', 'claude', 'deepseek', '', 5],
                telegramBotEnabled: true,
                extra: 'ignored',
            }),
            'utf8',
        );
        const p = await loadUserPreferences(dir);
        expect(p.defaultModel).toBe('deepseek');
        expect(p.enabledModels).toEqual(['deepseek', 'claude']);
        expect(p.telegramBotEnabled).toBe(true);
        expect((p as Record<string, unknown>).extra).toBeUndefined();
    });
});

describe('saveUserPreferences', () => {
    it('writes sanitized JSON and returns the cleaned object', async () => {
        const out = await saveUserPreferences(dir, {
            defaultModel: 'deepseek',
            enabledModels: ['deepseek', '', 'claude'],
            telegramBotEnabled: false,
        });
        expect(out.defaultModel).toBe('deepseek');
        expect(out.enabledModels).toEqual(['deepseek', 'claude']);
        expect(out.telegramBotEnabled).toBeUndefined(); // false is dropped
        const raw = JSON.parse(await fs.readFile(join(dir, 'preferences.json'), 'utf8'));
        expect(raw.defaultModel).toBe('deepseek');
    });

    it('drops empty defaultModel and empty enabledModels', async () => {
        const out = await saveUserPreferences(dir, {
            defaultModel: '   ',
            enabledModels: [],
        });
        expect(out.defaultModel).toBeUndefined();
        expect(out.enabledModels).toBeUndefined();
    });
});
