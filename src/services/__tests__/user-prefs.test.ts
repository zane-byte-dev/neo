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
                defaultModel: '  flash  ',
                enabledModels: ['flash', 'pro', 'flash', '', 5],
                telegramBotEnabled: true,
                extra: 'ignored',
            }),
            'utf8',
        );
        const p = await loadUserPreferences(dir);
        expect(p.defaultModel).toBe('flash');
        expect(p.enabledModels).toEqual(['flash', 'pro']);
        expect(p.telegramBotEnabled).toBe(true);
        expect((p as Record<string, unknown>).extra).toBeUndefined();
    });
});

describe('saveUserPreferences', () => {
    it('writes sanitized JSON and returns the cleaned object', async () => {
        const out = await saveUserPreferences(dir, {
            defaultModel: 'flash',
            enabledModels: ['flash', '', 'pro'],
            telegramBotEnabled: false,
        });
        expect(out.defaultModel).toBe('flash');
        expect(out.enabledModels).toEqual(['flash', 'pro']);
        expect(out.telegramBotEnabled).toBeUndefined(); // false is dropped
        const raw = JSON.parse(await fs.readFile(join(dir, 'preferences.json'), 'utf8'));
        expect(raw.defaultModel).toBe('flash');
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
