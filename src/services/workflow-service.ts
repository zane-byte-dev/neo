import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgentTurn } from './agent-runner.js';
import { calcUser } from './user-service.js';
import { executeSkill } from '../skills/skill-executor.js';
import { persistImageArtifact, readRunOutcome } from '../runtime/outcome.js';
import { pruneTextChunkEventsSafe } from '../runtime/executor.js';
import { generateId } from '../utils/id-generator.js';
import { parseJsonOr } from '../utils/json.js';
import type { ToolContext } from '../llm/types.js';

export type WorkflowTrigger =
    | { type: 'manual' }
    | { type: 'webhook'; secret?: string }
    | { type: 'cron'; cron: string; timezone?: string; enabled?: boolean; telegramChatId?: string };

export type WorkflowStep =
    | { id: string; name?: string; type: 'transform'; template: string }
    | { id: string; name?: string; type: 'agent'; message: string }
    | { id: string; name?: string; type: 'skill'; skillName: string; args?: Record<string, unknown> };

export interface WorkflowDefinition {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    trigger: WorkflowTrigger;
    steps: WorkflowStep[];
    createdAt: string;
    updatedAt: string;
}

export interface WorkflowStepRun {
    id: string;
    name?: string;
    type: WorkflowStep['type'];
    status: 'running' | 'success' | 'error';
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    output?: unknown;
    error?: string;
}

export interface WorkflowRunRecord {
    id: string;
    workflowId: string;
    workflowName: string;
    triggerType: WorkflowTrigger['type'];
    status: 'running' | 'success' | 'error';
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    input?: unknown;
    output?: unknown;
    error?: string;
    steps: WorkflowStepRun[];
}

interface WorkflowStore {
    workflows: Record<string, WorkflowDefinition>;
}

const WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_WORKFLOW_RUNS = 200;

function workflowsDir(stateDir: string): string {
    return join(stateDir, 'workflows');
}

function workflowsPath(stateDir: string): string {
    return join(workflowsDir(stateDir), 'workflows.json');
}

function runsPath(stateDir: string): string {
    return join(workflowsDir(stateDir), 'runs.json');
}

async function readStore(stateDir: string): Promise<WorkflowStore> {
    try {
        const raw = await readFile(workflowsPath(stateDir), 'utf8');
        const parsed = parseJsonOr<unknown>(raw, { workflows: {} });
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { workflows: {} };
        const workflows = (parsed as WorkflowStore).workflows;
        return workflows && typeof workflows === 'object' ? { workflows } : { workflows: {} };
    } catch {
        return { workflows: {} };
    }
}

async function writeStore(stateDir: string, store: WorkflowStore): Promise<void> {
    await mkdir(workflowsDir(stateDir), { recursive: true });
    await writeFile(workflowsPath(stateDir), JSON.stringify(store, null, 2), 'utf8');
}

async function readRuns(stateDir: string): Promise<WorkflowRunRecord[]> {
    try {
        const raw = await readFile(runsPath(stateDir), 'utf8');
        const parsed = parseJsonOr<unknown>(raw, []);
        return Array.isArray(parsed) ? parsed as WorkflowRunRecord[] : [];
    } catch {
        return [];
    }
}

async function writeRuns(stateDir: string, runs: WorkflowRunRecord[]): Promise<void> {
    await mkdir(workflowsDir(stateDir), { recursive: true });
    const sorted = [...runs]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, MAX_WORKFLOW_RUNS);
    await writeFile(runsPath(stateDir), JSON.stringify(sorted, null, 2), 'utf8');
}

async function saveRun(stateDir: string, run: WorkflowRunRecord): Promise<void> {
    const runs = await readRuns(stateDir);
    const index = runs.findIndex((item) => item.id === run.id);
    if (index >= 0) runs[index] = run;
    else runs.unshift(run);
    await writeRuns(stateDir, runs);
}

function assertWorkflowId(id: string): void {
    if (!WORKFLOW_ID_PATTERN.test(id)) {
        throw new Error('Workflow id must be 1-64 characters: letters, numbers, dot, underscore or hyphen');
    }
}

function normalizeTrigger(input: unknown): WorkflowTrigger {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { type: 'manual' };
    const raw = input as Record<string, unknown>;
    const type = raw.type;
    if (type === 'webhook') {
        return {
            type: 'webhook',
            ...(typeof raw.secret === 'string' && raw.secret ? { secret: raw.secret } : {}),
        };
    }
    if (type === 'cron') {
        const cron = typeof raw.cron === 'string' ? raw.cron.trim() : '';
        if (!cron) throw new Error('Cron workflow trigger requires `cron`');
        return {
            type: 'cron',
            cron,
            enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
            ...(typeof raw.timezone === 'string' && raw.timezone.trim() ? { timezone: raw.timezone.trim() } : {}),
            ...(typeof raw.telegramChatId === 'string' && raw.telegramChatId.trim() ? { telegramChatId: raw.telegramChatId.trim() } : {}),
        };
    }
    return { type: 'manual' };
}

function normalizeStep(rawStep: unknown, index: number): WorkflowStep {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
        throw new Error(`Workflow step ${index + 1} must be an object`);
    }
    const raw = rawStep as Record<string, unknown>;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `step_${index + 1}`;
    assertWorkflowId(id);
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined;
    if (raw.type === 'transform') {
        const template = typeof raw.template === 'string' ? raw.template : '';
        if (!template) throw new Error(`Workflow step ${id} requires template`);
        return { id, ...(name ? { name } : {}), type: 'transform', template };
    }
    if (raw.type === 'agent') {
        const message = typeof raw.message === 'string' ? raw.message : '';
        if (!message) throw new Error(`Workflow step ${id} requires message`);
        return { id, ...(name ? { name } : {}), type: 'agent', message };
    }
    if (raw.type === 'skill') {
        const skillName = typeof raw.skillName === 'string' ? raw.skillName.trim() : '';
        if (!skillName) throw new Error(`Workflow step ${id} requires skillName`);
        const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args)
            ? raw.args as Record<string, unknown>
            : undefined;
        return { id, ...(name ? { name } : {}), type: 'skill', skillName, ...(args ? { args } : {}) };
    }
    throw new Error(`Workflow step ${id} has unsupported type`);
}

export function normalizeWorkflowInput(id: string, input: unknown, existing?: WorkflowDefinition): WorkflowDefinition {
    assertWorkflowId(id);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Workflow body must be an object');
    }
    const raw = input as Record<string, unknown>;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : existing?.name ?? id;
    const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : existing?.description;
    const stepsRaw = Array.isArray(raw.steps) ? raw.steps : existing?.steps;
    if (!stepsRaw || stepsRaw.length === 0) throw new Error('Workflow requires at least one step');
    if (stepsRaw.length > 20) throw new Error('Workflow supports at most 20 steps');
    const now = new Date().toISOString();
    return {
        id,
        name,
        ...(description ? { description } : {}),
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : existing?.enabled ?? true,
        trigger: normalizeTrigger(raw.trigger ?? existing?.trigger),
        steps: stepsRaw.map(normalizeStep),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
}

export async function listWorkflows(stateDir: string): Promise<WorkflowDefinition[]> {
    const store = await readStore(stateDir);
    return Object.values(store.workflows).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getWorkflow(stateDir: string, id: string): Promise<WorkflowDefinition | null> {
    assertWorkflowId(id);
    const store = await readStore(stateDir);
    return store.workflows[id] ?? null;
}

export async function saveWorkflow(stateDir: string, id: string, input: unknown): Promise<WorkflowDefinition> {
    const store = await readStore(stateDir);
    const workflow = normalizeWorkflowInput(id, input, store.workflows[id]);
    store.workflows[id] = workflow;
    await writeStore(stateDir, store);
    return workflow;
}

export async function deleteWorkflow(stateDir: string, id: string): Promise<boolean> {
    assertWorkflowId(id);
    const store = await readStore(stateDir);
    if (!store.workflows[id]) return false;
    delete store.workflows[id];
    await writeStore(stateDir, store);
    return true;
}

export async function listWorkflowRuns(stateDir: string, workflowId?: string, limit = 20): Promise<WorkflowRunRecord[]> {
    const runs = await readRuns(stateDir);
    return runs
        .filter((run) => !workflowId || run.workflowId === workflowId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, Math.max(1, Math.min(limit, 100)));
}

function resolvePath(source: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((value, part) => {
        if (value && typeof value === 'object' && part in value) return (value as Record<string, unknown>)[part];
        return undefined;
    }, source);
}

function stringifyTemplateValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderTemplate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
        return stringifyTemplateValue(resolvePath(variables, path));
    });
}

function renderValue(value: unknown, variables: Record<string, unknown>): unknown {
    if (typeof value === 'string') return renderTemplate(value, variables);
    if (Array.isArray(value)) return value.map((item) => renderValue(item, variables));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, renderValue(item, variables)]));
    }
    return value;
}

function truncateSummary(value: unknown): string {
    const text = stringifyTemplateValue(value).trim();
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

export async function runWorkflow(
    userId: string,
    workflow: WorkflowDefinition,
    input: unknown = {},
    triggerType: WorkflowTrigger['type'] = 'manual',
): Promise<WorkflowRunRecord> {
    if (!workflow.enabled) throw new Error(`Workflow "${workflow.id}" is disabled`);
    const userCtx = await calcUser(userId);
    const run: WorkflowRunRecord = {
        id: generateId(),
        workflowId: workflow.id,
        workflowName: workflow.name,
        triggerType,
        status: 'running',
        startedAt: new Date().toISOString(),
        input,
        steps: [],
    };
    await saveRun(userCtx.stateDir, run);

    const stepOutputs: Record<string, unknown> = {};
    let previous: unknown = input;

    for (const step of workflow.steps) {
        const stepRun: WorkflowStepRun = {
            id: step.id,
            ...(step.name ? { name: step.name } : {}),
            type: step.type,
            status: 'running',
            startedAt: new Date().toISOString(),
        };
        run.steps.push(stepRun);
        await saveRun(userCtx.stateDir, run);

        try {
            const variables = { input, previous, steps: stepOutputs, workflow, runId: run.id, now: new Date().toISOString() };
            let output: unknown;
            if (step.type === 'transform') {
                output = renderTemplate(step.template, variables);
            } else if (step.type === 'agent') {
                const message = renderTemplate(step.message, variables);
                let agentRunId: string | undefined;
                const text = await runAgentTurn({
                    userId,
                    sessionId: `workflow-${workflow.id}-${run.id}-${step.id}`,
                    message,
                    entrypoint: 'workflow',
                    triggerType: `workflow_${triggerType}`,
                    metadata: { workflowId: workflow.id, workflowRunId: run.id, stepId: step.id },
                    onRunCreated: (id) => { agentRunId = id; },
                    onImage: async (data, mimeType, caption) => {
                        if (!agentRunId) return undefined;
                        return persistImageArtifact(userCtx.stateDir, agentRunId, data, mimeType, caption);
                    },
                    onVideo: async (url) => ({ url }),
                });
                if (agentRunId) await pruneTextChunkEventsSafe(userCtx.stateDir, agentRunId);
                const outcome = agentRunId ? await readRunOutcome(userCtx.stateDir, agentRunId, { fallbackText: text }) : null;
                output = outcome?.responseText ?? text;
            } else {
                const skill = userCtx.skillRegistry.get(step.skillName);
                if (!skill) throw new Error(`Skill "${step.skillName}" not found`);
                const context: ToolContext = {
                    userId,
                    sessionId: `workflow-${workflow.id}-${run.id}-${step.id}`,
                    workDir: userCtx.workDir,
                    homeWorkDir: userCtx.workDir,
                    stateDir: userCtx.stateDir,
                    systemInstruction: userCtx.systemInstruction,
                    skillRegistry: userCtx.skillRegistry,
                    userTools: userCtx.userTools,
                };
                output = await executeSkill(skill, renderValue(step.args ?? {}, variables) as Record<string, unknown>, context);
            }
            const finishedAt = new Date().toISOString();
            stepRun.status = 'success';
            stepRun.finishedAt = finishedAt;
            stepRun.durationMs = Date.parse(finishedAt) - Date.parse(stepRun.startedAt);
            stepRun.output = output;
            stepOutputs[step.id] = output;
            previous = output;
            await saveRun(userCtx.stateDir, run);
        } catch (err: unknown) {
            const finishedAt = new Date().toISOString();
            const message = err instanceof Error ? err.message : String(err);
            stepRun.status = 'error';
            stepRun.finishedAt = finishedAt;
            stepRun.durationMs = Date.parse(finishedAt) - Date.parse(stepRun.startedAt);
            stepRun.error = message;
            run.status = 'error';
            run.finishedAt = finishedAt;
            run.durationMs = Date.parse(finishedAt) - Date.parse(run.startedAt);
            run.error = message;
            await saveRun(userCtx.stateDir, run);
            return run;
        }
    }

    const finishedAt = new Date().toISOString();
    run.status = 'success';
    run.finishedAt = finishedAt;
    run.durationMs = Date.parse(finishedAt) - Date.parse(run.startedAt);
    run.output = previous;
    await saveRun(userCtx.stateDir, run);
    return run;
}

export async function runWorkflowById(
    userId: string,
    stateDir: string,
    id: string,
    input: unknown,
    triggerType: WorkflowTrigger['type'],
): Promise<WorkflowRunRecord> {
    const workflow = await getWorkflow(stateDir, id);
    if (!workflow) throw new Error(`Workflow "${id}" not found`);
    return runWorkflow(userId, workflow, input, triggerType);
}

export function workflowRunSummary(run: WorkflowRunRecord | null | undefined): string | null {
    if (!run) return null;
    if (run.status === 'error') return run.error ?? null;
    return truncateSummary(run.output ?? run.steps.at(-1)?.output ?? null) || null;
}