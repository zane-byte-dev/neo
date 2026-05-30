/**
 * Per-user Local AI Gateway settings.
 *
 * UI-managed settings live in {stateDir}/gateway.json. A configured
 * ConfigUser.gatewayToken remains supported as a legacy/static fallback unless
 * the state file explicitly overrides it.
 */

import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { ConfigUser } from '../config.js';
import { parseJsonOr } from '../utils/json.js';

const FILE_NAME = 'gateway.json';

export interface GatewayStateFile {
    enabled?: boolean;
    tokenHash?: string;
    tokenTail?: string;
    /** Legacy plaintext token support for early local builds. New writes use tokenHash only. */
    token?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface GatewayStatus {
    enabled: boolean;
    configured: boolean;
    source: 'state' | 'config' | 'none';
    masked: string;
    baseUrl: string;
    token?: string;
}

export interface GatewayUpdate {
    enabled?: boolean;
    rotate?: boolean;
}

function statePath(stateDir: string): string {
    return join(stateDir, FILE_NAME);
}

function maskToken(token: string): string {
    if (!token) return '';
    return `••••${token.slice(-6)}`;
}

function generateGatewayToken(): string {
    return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
}

function sanitizeState(input: unknown): GatewayStateFile | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    const state: GatewayStateFile = {};
    if (typeof raw.enabled === 'boolean') state.enabled = raw.enabled;
    if (typeof raw.tokenHash === 'string' && raw.tokenHash.trim()) state.tokenHash = raw.tokenHash.trim();
    if (typeof raw.tokenTail === 'string' && raw.tokenTail.trim()) state.tokenTail = raw.tokenTail.trim();
    if (typeof raw.token === 'string' && raw.token.trim()) state.token = raw.token.trim();
    if (typeof raw.createdAt === 'string') state.createdAt = raw.createdAt;
    if (typeof raw.updatedAt === 'string') state.updatedAt = raw.updatedAt;
    return state;
}

function readStateSync(stateDir: string | null | undefined): GatewayStateFile | null {
    if (!stateDir) return null;
    try {
        return sanitizeState(parseJsonOr(readFileSync(statePath(stateDir), 'utf8'), {}));
    } catch {
        return null;
    }
}

async function readState(stateDir: string): Promise<GatewayStateFile | null> {
    try {
        return sanitizeState(parseJsonOr(await fs.readFile(statePath(stateDir), 'utf8'), {}));
    } catch {
        return null;
    }
}

async function writeState(stateDir: string, state: GatewayStateFile): Promise<void> {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(statePath(stateDir), JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
        await fs.chmod(statePath(stateDir), 0o600);
    } catch {
        /* best effort */
    }
}

function statusFrom(token: string, source: GatewayStatus['source'], baseUrl: string, exposeToken = false): GatewayStatus {
    return {
        enabled: Boolean(token),
        configured: Boolean(token),
        source,
        masked: maskToken(token),
        baseUrl,
        ...(exposeToken && token ? { token } : {}),
    };
}

function statusFromState(state: GatewayStateFile, baseUrl: string): GatewayStatus {
    const tail = state.tokenTail ?? state.token?.slice(-6) ?? '';
    return {
        enabled: true,
        configured: true,
        source: 'state',
        masked: tail ? `••••${tail}` : '',
        baseUrl,
    };
}

export function hasEffectiveGatewayTokenSync(user: ConfigUser): boolean {
    const state = readStateSync(user.stateDir);
    if (state) {
        return state.enabled === true && Boolean(state.tokenHash || state.token);
    }
    return Boolean(user.gatewayToken?.trim());
}

export function matchesGatewayTokenSync(user: ConfigUser, token: string): boolean {
    if (!token) return false;
    const state = readStateSync(user.stateDir);
    if (state) {
        if (state.enabled !== true) return false;
        if (state.tokenHash) return safeEqual(hashToken(token), state.tokenHash);
        return state.token ? safeEqual(token, state.token) : false;
    }
    const expected = user.gatewayToken?.trim() ?? '';
    return expected ? safeEqual(token, expected) : false;
}

export function getGatewayStatusSync(user: ConfigUser, baseUrl = '/v1'): GatewayStatus {
    const state = readStateSync(user.stateDir);
    if (state) {
        if (state.enabled === true && (state.tokenHash || state.token)) return statusFromState(state, baseUrl);
        return { enabled: false, configured: false, source: 'state', masked: '', baseUrl };
    }
    const configToken = user.gatewayToken?.trim() ?? '';
    if (configToken) return statusFrom(configToken, 'config', baseUrl);
    return { enabled: false, configured: false, source: 'none', masked: '', baseUrl };
}

export async function getGatewayStatus(user: ConfigUser, stateDir: string, baseUrl = '/v1'): Promise<GatewayStatus> {
    const state = await readState(stateDir);
    if (state) {
        if (state.enabled === true && (state.tokenHash || state.token)) return statusFromState(state, baseUrl);
        return { enabled: false, configured: false, source: 'state', masked: '', baseUrl };
    }
    const configToken = user.gatewayToken?.trim() ?? '';
    if (configToken) return statusFrom(configToken, 'config', baseUrl);
    return { enabled: false, configured: false, source: 'none', masked: '', baseUrl };
}

export async function updateGatewayStatus(user: ConfigUser, stateDir: string, update: GatewayUpdate, baseUrl = '/v1'): Promise<GatewayStatus> {
    const now = new Date().toISOString();
    const current = await readState(stateDir);
    const currentToken = current?.token ?? '';
    const currentHasStoredToken = Boolean(current?.tokenHash || currentToken);
    const nextEnabled = update.enabled ?? current?.enabled ?? Boolean(user.gatewayToken?.trim());

    if (!nextEnabled) {
        const next: GatewayStateFile = { enabled: false, updatedAt: now };
        await writeState(stateDir, next);
        return { enabled: false, configured: false, source: 'state', masked: '', baseUrl };
    }

    const shouldGenerate = update.rotate === true || !currentHasStoredToken;
    if (!shouldGenerate && current?.tokenHash) {
        const next: GatewayStateFile = {
            enabled: true,
            tokenHash: current.tokenHash,
            tokenTail: current.tokenTail,
            createdAt: current.createdAt ?? now,
            updatedAt: now,
        };
        await writeState(stateDir, next);
        return statusFromState(next, baseUrl);
    }

    const token = shouldGenerate ? generateGatewayToken() : currentToken;
    const next: GatewayStateFile = {
        enabled: true,
        tokenHash: hashToken(token),
        tokenTail: token.slice(-6),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
    };
    await writeState(stateDir, next);
    return statusFrom(token, 'state', baseUrl, shouldGenerate);
}