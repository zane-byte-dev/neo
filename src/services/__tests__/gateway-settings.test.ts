import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigUser } from '../../config.js';
import { getGatewayStatus, matchesGatewayTokenSync, updateGatewayStatus } from '../gateway-settings.js';

let stateDir: string;

beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'gateway-settings-'));
});

afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
});

function user(overrides: Partial<ConfigUser> = {}): ConfigUser {
    return {
        id: 'u1',
        name: 'User',
        workDir: stateDir,
        stateDir,
        ...overrides,
    };
}

describe('gateway settings', () => {
    it('falls back to config gatewayToken when no UI state exists', async () => {
        const cfg = user({ gatewayToken: 'config-token' });

        const status = await getGatewayStatus(cfg, stateDir, 'http://localhost:3000/v1');

        expect(status).toMatchObject({ enabled: true, configured: true, source: 'config', masked: '••••-token' });
        expect(status.token).toBeUndefined();
        expect(matchesGatewayTokenSync(cfg, 'config-token')).toBe(true);
    });

    it('generates a UI-managed token and only exposes it on creation', async () => {
        const cfg = user();

        const created = await updateGatewayStatus(cfg, stateDir, { enabled: true }, 'http://localhost:3000/v1');
        expect(created.enabled).toBe(true);
        expect(created.source).toBe('state');
        expect(created.token).toMatch(/^[a-f0-9]{64}$/);
        expect(matchesGatewayTokenSync(cfg, created.token!)).toBe(true);

        const stored = JSON.parse(readFileSync(join(stateDir, 'gateway.json'), 'utf8')) as Record<string, unknown>;
        expect(stored.token).toBeUndefined();
        expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(stored.tokenTail).toBe(created.token!.slice(-6));

        const reloaded = await getGatewayStatus(cfg, stateDir, 'http://localhost:3000/v1');
        expect(reloaded.token).toBeUndefined();
        expect(reloaded.masked).toBe(`••••${created.token!.slice(-6)}`);
    });

    it('can rotate and disable the UI-managed token', async () => {
        const cfg = user({ gatewayToken: 'config-token' });
        const first = await updateGatewayStatus(cfg, stateDir, { enabled: true }, '/v1');
        const second = await updateGatewayStatus(cfg, stateDir, { enabled: true, rotate: true }, '/v1');
        expect(second.token).toMatch(/^[a-f0-9]{64}$/);
        expect(second.token).not.toBe(first.token);

        const disabled = await updateGatewayStatus(cfg, stateDir, { enabled: false }, '/v1');
        expect(disabled).toMatchObject({ enabled: false, configured: false, source: 'state' });
        expect(matchesGatewayTokenSync(cfg, 'config-token')).toBe(false);
    });
});