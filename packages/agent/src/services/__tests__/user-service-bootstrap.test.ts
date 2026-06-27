import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calcUser, invalidateUserCache } from '../user-service.js';

let previousUsers: string | undefined;
let tempRoot: string;
let workDir: string;
let stateDir: string;

beforeEach(() => {
    previousUsers = process.env.USERS;
    tempRoot = mkdtempSync(join(tmpdir(), 'neo-user-service-bootstrap-'));
    workDir = join(tempRoot, 'workspace');
    stateDir = join(tempRoot, 'state');
    process.env.USERS = JSON.stringify([
        {
            id: 'new-user',
            name: 'New User',
            workDir,
            stateDir,
        },
    ]);
    invalidateUserCache('new-user');
});

afterEach(() => {
    invalidateUserCache('new-user');
    if (previousUsers === undefined) delete process.env.USERS;
    else process.env.USERS = previousUsers;
    rmSync(tempRoot, { recursive: true, force: true });
});

describe('calcUser workspace bootstrap', () => {
    it('bootstraps a missing workspace before loading user context', async () => {
        const userCtx = await calcUser('new-user', true);

        expect(userCtx.workDir).toBe(workDir);
        expect(userCtx.stateDir).toBe(stateDir);
        expect(userCtx.systemInstruction).toContain('# AGENTS');
        expect(userCtx.systemInstruction).toContain('[用户档案]');

        await expect(fs.readFile(join(workDir, 'AGENTS.md'), 'utf8')).resolves.toContain('# AGENTS');
        await expect(fs.readFile(join(workDir, 'USER.md'), 'utf8')).resolves.toContain('# USER');
        await expect(fs.stat(join(stateDir, 'skills'))).resolves.toBeDefined();
    });
});