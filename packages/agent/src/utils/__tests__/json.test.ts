import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseJsonLines, parseJsonOr, readJsonFileSyncOr } from '../json.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'neo-json-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('parseJsonOr', () => {
    it('returns parsed JSON when valid', () => {
        expect(parseJsonOr('{"ok":true}', { ok: false })).toEqual({ ok: true });
    });

    it('returns fallback when JSON is invalid', () => {
        expect(parseJsonOr('{broken', { ok: false })).toEqual({ ok: false });
    });
});

describe('parseJsonLines', () => {
    it('returns only valid JSON lines and skips blanks or malformed rows', () => {
        const text = ['{"id":1}', '', '{broken', '{"id":2}'].join('\n');
        expect(parseJsonLines<{ id: number }>(text)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('preserves JSON null values as skipped malformed-equivalent rows', () => {
        const text = ['null', '{"id":3}'].join('\n');
        expect(parseJsonLines<{ id: number }>(text)).toEqual([{ id: 3 }]);
    });
});

describe('readJsonFileSyncOr', () => {
    it('returns file contents when the file contains valid JSON', () => {
        const dir = makeTempDir();
        const file = join(dir, 'config.json');
        writeFileSync(file, '{"enabled":true}', 'utf8');

        expect(readJsonFileSyncOr(file, { enabled: false })).toEqual({ enabled: true });
    });

    it('returns fallback when the file is missing or malformed', () => {
        const dir = makeTempDir();
        const missing = join(dir, 'missing.json');
        const invalid = join(dir, 'invalid.json');
        writeFileSync(invalid, '{broken', 'utf8');

        expect(readJsonFileSyncOr(missing, { enabled: false })).toEqual({ enabled: false });
        expect(readJsonFileSyncOr(invalid, { enabled: false })).toEqual({ enabled: false });
    });
});