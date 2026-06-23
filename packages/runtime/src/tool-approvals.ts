import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { generateId } from './internal/id-generator.js';
import type { JsonObject, JsonValue, ToolApprovalScope } from './types.js';

const TOOL_APPROVALS_VERSION = 3;

export type ToolApprovalMatchMode = 'exact' | 'tool';

export interface ToolApprovalRule {
    id: string;
    toolName: string;
    policyKey: string;
    matchMode: ToolApprovalMatchMode;
    scope: Exclude<ToolApprovalScope, 'once'>;
    createdAt: string;
    updatedAt: string;
    sessionId?: string;
    args?: JsonObject;
}

interface StoredToolApprovalRule extends Omit<ToolApprovalRule, 'matchMode'> {
    matchMode?: ToolApprovalMatchMode;
}

interface ToolApprovalStore {
    version: number;
    rules: ToolApprovalRule[];
}

interface StoredToolApprovalStore {
    version?: number;
    rules?: StoredToolApprovalRule[];
}

export interface MatchApprovalInput {
    sessionId?: string;
    toolName: string;
    args: Record<string, unknown>;
}

export interface SaveApprovalInput extends MatchApprovalInput {
    scope: Exclude<ToolApprovalScope, 'once'>;
    matchMode?: ToolApprovalMatchMode;
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

function resolveMatchMode(toolName: string, requested?: ToolApprovalMatchMode): ToolApprovalMatchMode {
    if (requested === 'exact' || requested === 'tool') return requested;
    return toolName === 'bash' ? 'tool' : 'exact';
}

function normalizeStoredRule(rule: StoredToolApprovalRule): ToolApprovalRule {
    const matchMode = resolveMatchMode(rule.toolName, rule.matchMode);
    const args = rule.args ? normalizeArgs(rule.toolName, rule.args as Record<string, unknown>) : undefined;
    return {
        ...rule,
        matchMode,
        policyKey: buildToolApprovalPolicyKey(rule.toolName, args ?? {}, matchMode),
        ...(args !== undefined ? { args } : {}),
    };
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

export function buildToolApprovalPolicyKey(
    toolName: string,
    args: Record<string, unknown>,
    matchMode: ToolApprovalMatchMode = 'exact',
): string {
    if (matchMode === 'tool') return `${toolName}:*`;
    return `${toolName}:${stableSerialize(normalizeArgs(toolName, args))}`;
}

function matchesToolApprovalRule(
    rule: ToolApprovalRule,
    toolName: string,
    policyKey: string,
): boolean {
    if (rule.toolName !== toolName) return false;
    if (rule.matchMode === 'tool') return true;
    return rule.policyKey === policyKey;
}

export async function matchToolApprovalScope(
    stateDir: string,
    input: MatchApprovalInput,
): Promise<Exclude<ToolApprovalScope, 'once'> | null> {
    const store = await loadToolApprovalStore(stateDir);
    const policyKey = buildToolApprovalPolicyKey(input.toolName, input.args);
    const hasAlways = store.rules.some((rule) => (
        rule.scope === 'always'
        && matchesToolApprovalRule(rule, input.toolName, policyKey)
    ));
    if (hasAlways) return 'always';
    if (!input.sessionId) return null;
    const hasSession = store.rules.some((rule) => (
        rule.scope === 'session'
        && rule.sessionId === input.sessionId
        && matchesToolApprovalRule(rule, input.toolName, policyKey)
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
    const matchMode = resolveMatchMode(input.toolName, input.matchMode);
    const policyKey = buildToolApprovalPolicyKey(input.toolName, normalizedArgs, matchMode);
    if (matchMode === 'tool') {
        store.rules = store.rules.filter((rule) => !(
            rule.toolName === input.toolName
            && rule.scope === input.scope
            && (input.scope !== 'session' || rule.sessionId === input.sessionId)
            && rule.matchMode !== 'tool'
        ));
    }
    const existingIndex = store.rules.findIndex((rule) => (
        rule.scope === input.scope
        && rule.toolName === input.toolName
        && rule.policyKey === policyKey
        && rule.matchMode === matchMode
        && (input.scope !== 'session' || rule.sessionId === input.sessionId)
    ));

    if (existingIndex >= 0) {
        const existing = store.rules[existingIndex];
        store.rules[existingIndex] = {
            ...existing,
            updatedAt: now,
            matchMode,
            policyKey,
            args: normalizedArgs,
        };
    } else {
        store.rules.push({
            id: `approval_${generateId()}`,
            toolName: input.toolName,
            policyKey,
            matchMode,
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
        const parsed = JSON.parse(raw) as StoredToolApprovalStore;
        return {
            version: typeof parsed.version === 'number' ? parsed.version : TOOL_APPROVALS_VERSION,
            rules: Array.isArray(parsed.rules)
                ? parsed.rules
                    .filter((rule): rule is StoredToolApprovalRule => (
                        typeof rule === 'object'
                        && rule !== null
                        && typeof rule.id === 'string'
                        && typeof rule.toolName === 'string'
                        && typeof rule.policyKey === 'string'
                        && typeof rule.scope === 'string'
                        && typeof rule.createdAt === 'string'
                        && typeof rule.updatedAt === 'string'
                    ))
                    .map((rule) => normalizeStoredRule(rule))
                : [],
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
