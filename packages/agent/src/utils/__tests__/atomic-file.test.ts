import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic, writeFileAtomicSync, writeJsonAtomic, writeJsonAtomicSync } from '../atomic-file.js';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atomic-file-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('atomic-file', () => {
    it('writes and replaces text asynchronously', async () => {
        const path = join(dir, 'nested', 'file.txt');
        await writeFileAtomic(path, 'first');
        await writeFileAtomic(path, 'second');
        expect(await fs.readFile(path, 'utf8')).toBe('second');
    });

    it('writes and replaces text synchronously', async () => {
        const path = join(dir, 'nested', 'file-sync.txt');
        writeFileAtomicSync(path, 'first');
        writeFileAtomicSync(path, 'second');
        expect(await fs.readFile(path, 'utf8')).toBe('second');
    });

    it('serializes JSON with a trailing newline', async () => {
        const asyncPath = join(dir, 'async.json');
        const syncPath = join(dir, 'sync.json');
        await writeJsonAtomic(asyncPath, { ok: true });
        writeJsonAtomicSync(syncPath, { ok: true });
        expect(await fs.readFile(asyncPath, 'utf8')).toBe('{\n  "ok": true\n}\n');
        expect(await fs.readFile(syncPath, 'utf8')).toBe('{\n  "ok": true\n}\n');
    });
});
