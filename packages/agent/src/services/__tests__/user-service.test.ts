import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    userList,
    userGetByTenant,
    userGetByWebToken,
    userGetWorkDir,
    userGetWorkspaceDir,
    userGetStateDir,
    hasApiTokenConfigured,
    userGetByApiToken,
    getWebhookSecret,
} from '../user-service.js';

const SAMPLE = [
    {
        id: 'alice',
        name: 'Alice',
        tenants: ['tg:111'],
        webToken: 'tok-alice',
        apiToken: 'gw-alice',
        webhookSecret: 'whk-alice',
        workDir: '/tmp/alice/proj',
        stateDir: '/tmp/alice/state',
    },
    {
        id: 'bob',
        name: 'Bob',
        webToken: 'tok-bob',
        workDir: '/tmp/bob/ws',
    },
];

let prevUsers: string | undefined;
let tempDirs: string[];

beforeEach(() => {
    prevUsers = process.env.USERS;
    tempDirs = [];
    process.env.USERS = JSON.stringify(SAMPLE);
});

afterEach(() => {
    if (prevUsers === undefined) delete process.env.USERS;
    else process.env.USERS = prevUsers;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('userList', () => {
    it('returns all users with resolved dirs', () => {
        const list = userList();
        expect(list.length).toBe(2);
        const a = list.find((u) => u.id === 'alice')!;
        expect(a.workDir).toBe('/tmp/alice/proj');
        expect(a.stateDir).toBe('/tmp/alice/state');
        expect(a.tenants).toContain('tg:111');
        const b = list.find((u) => u.id === 'bob')!;
        expect(b.workDir).toBe('/tmp/bob/ws');
        expect(b.stateDir).toBeNull();            // no stateDir configured
    });

    it('returns [] when USERS env is missing or invalid JSON', () => {
        delete process.env.USERS;
        expect(userList()).toEqual([]);
        process.env.USERS = '{not json';
        expect(userList()).toEqual([]);
    });
});

describe('userGetByTenant', () => {
    it('finds user by tenant key', () => {
        expect(userGetByTenant('tg:111')?.id).toBe('alice');
    });
    it('returns null when not found', () => {
        expect(userGetByTenant('nope')).toBeNull();
    });
});

describe('userGetByWebToken', () => {
    it('matches the exact web token', () => {
        expect(userGetByWebToken('tok-bob')?.id).toBe('bob');
    });
    it('returns null on miss', () => {
        expect(userGetByWebToken('nope')).toBeNull();
    });
});

describe('API token helpers', () => {
    it('detects configured API tokens', () => {
        expect(hasApiTokenConfigured()).toBe(true);
    });

    it('matches API token with timing-safe lookup', () => {
        expect(userGetByApiToken('gw-alice')?.id).toBe('alice');
        expect(userGetByApiToken('wrong')).toBeNull();
    });

    it('reports not configured when no user has apiToken', () => {
        process.env.USERS = JSON.stringify([{ id: 'u1', name: 'User', workDir: '/tmp' }]);
        expect(hasApiTokenConfigured()).toBe(false);
        expect(userGetByApiToken('any')).toBeNull();
    });
});

describe('userGetWorkDir / Workspace / State', () => {
    it('returns the resolved directory or null', () => {
        expect(userGetWorkDir('alice')).toBe('/tmp/alice/proj');
        expect(userGetWorkspaceDir('bob')).toBe('/tmp/bob/ws');
        expect(userGetStateDir('alice')).toBe('/tmp/alice/state');
        expect(userGetStateDir('bob')).toBeNull();
        expect(userGetWorkDir('ghost')).toBeNull();
    });
});

describe('getWebhookSecret', () => {
    it('returns the stored secret or null', () => {
        expect(getWebhookSecret('alice')).toBe('whk-alice');
        expect(getWebhookSecret('bob')).toBeNull();
        expect(getWebhookSecret('ghost')).toBeNull();
    });
});
