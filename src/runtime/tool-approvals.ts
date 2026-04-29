import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import type { JsonObject, JsonValue, ToolApprovalScope } from './types.js';

const TOOL_APPROVALS_VERSION = 2;

export interface ToolApprovalRule {
    id: string;
    toolName: string;
    policyKey: string;
    scope: Exclude<ToolApprovalScope, 'once'>;
    createdAt: string;
    updatedAt: string;
    sessionId?: string;
    args?: JsonObject;
}

interface ToolApprovalStore {
    version: number;
    rules: ToolApprovalRule[];
}

interface MatchApprovalInput {
    sessionId?: string;
    toolName: string;
    args: Record<string, unknown>;
}

interface SaveApprovalInput extends MatchApprovalInput {
    scope: Exclude<ToolApprovalScope, 'once'>;
}

function approvalsFilePath(stateDir: string): string {
    return join(resolve(stateDir), 'tool-approvals.json');
}

function normalizeArgs(toolName: string, args: Record<string, unknown>): JsonObject {
    const normalizedValue = normalizeJsonValue(args);
    const normalized: JsonObject = normalizedValue && typeof normalizedValue === 'object' && !Array.isArray(normalizedValue)
        ? normalizedValue as JsonObject
        : {};
    if (toolName === 'bash' && typeof normalized.command === 'string') {
        normalized.command = normalized.command.trim();
    }
    return normalized;
}

function normalizeJsonValue(value: unknown): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeJsonValue(entry));
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        const next: JsonObject = {};
        for (const [key, entry] of entries) next[key] = normalizeJsonValue(entry);
        return next;
    }
    return String(value);
}

function stableSerialize(value: JsonValue): string {
    if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function buildToolApprovalPolicyKey(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}:${stableSerialize(normalizeArgs(toolName, args))}`;
}

export async function matchToolApprovalScope(
    stateDir: string,
    input: MatchApprovalInput,
): Promise<Exclude<ToolApprovalScope, 'once'> | null> {
    const store = await loadToolApprovalStore(stateDir);
    const policyKey = buildToolApprovalPolicyKey(input.toolName, input.args);
    const hasAlways = store.rules.some((rule) => (
        rule.scope === 'always'
        && rule.toolName === input.toolName
        && rule.policyKey === policyKey
    ));
    if (hasAlways) return 'always';
    if (!input.sessionId) return null;
    const hasSession = store.rules.some((rule) => (
        rule.scope === 'session'
        && rule.sessionId === input.sessionId
        && rule.toolName === input.toolName
        && rule.policyKey === policyKey
    ));
    return hasSession ? 'session' : null;
}

export async function saveToolApproval(
    stateDir: string,
    input: SaveApprovalInput,
): Promise<Exclude<ToolApprovalScope, 'once'>> {
    const store = await loadToolApprovalStore(stateDir);
    const now = new Date().toISOString();
    const normalizedArgs = normalizeArgs(input.toolName, input.args);
    const policyKey = `${input.toolName}:${stableSerialize(normalizedArgs)}`;
    const existingIndex = store.rules.findIndex((rule) => (
        rule.scope === input.scope
        && rule.toolName === input.toolName
        && rule.policyKey === policyKey
        && (input.scope !== 'session' || rule.sessionId === input.sessionId)
    ));

    if (existingIndex >= 0) {
        const existing = store.rules[existingIndex];
        store.rules[existingIndex] = {
            ...existing,
            updatedAt: now,
            args: normalizedArgs,
        };
    } else {
        store.rules.push({
            id: `approval_${generateId()}`,
            toolName: input.toolName,
            policyKey,
            scope: input.scope,
            createdAt: now,
            updatedAt: now,
            args: normalizedArgs,
            ...(input.scope === 'session' && input.sessionId ? { sessionId: input.sessionId } : {}),
        });
    }

    await writeToolApprovalStore(stateDir, store);
    return input.scope;
}

export async function listToolApprovals(stateDir: string): Promise<ToolApprovalRule[]> {
    const store = await loadToolApprovalStore(stateDir);
    return [...store.rules].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function deleteToolApproval(stateDir: string, ruleId: string): Promise<boolean> {
    const store = await loadToolApprovalStore(stateDir);
    const nextRules = store.rules.filter((rule) => rule.id !== ruleId);
    if (nextRules.length === store.rules.length) return false;
    await writeToolApprovalStore(stateDir, {
        ...store,
        rules: nextRules,
    });
    return true;
}

async function loadToolApprovalStore(stateDir: string): Promise<ToolApprovalStore> {
    const filePath = approvalsFilePath(stateDir);
    if (!existsSync(filePath)) {
        return { version: TOOL_APPROVALS_VERSION, rules: [] };
    }
    try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ToolApprovalStore>;
        return {
            version: typeof parsed.version === 'number' ? parsed.version : TOOL_APPROVALS_VERSION,
            rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        };
    } catch {
        return { version: TOOL_APPROVALS_VERSION, rules: [] };
    }
}

async function writeToolApprovalStore(stateDir: string, store: ToolApprovalStore): Promise<void> {
    const filePath = approvalsFilePath(stateDir);
    await mkdir(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf8');
    await rename(tmpPath, filePath);
}