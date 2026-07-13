import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { PiBridgeManager } from './pi-bridge-manager.js';
import { createPiSseAdapterState, mapPiEventToSse } from './pi-event-sse.js';
import { messageAdd, type MessageCitation } from '@neo/agent/services/chat-service.js';

const atmExtensionPath = process.env.NEO_PI_ATM_EXTENSION
    ?? fileURLToPath(new URL('../pi/extensions/atm-tools.ts', import.meta.url));
const atxExtensionPath = process.env.NEO_PI_ATX_EXTENSION
    ?? fileURLToPath(new URL('../pi/extensions/atx-provider.ts', import.meta.url));
const bundledSkillsPath = fileURLToPath(new URL('../pi/skills', import.meta.url));
const repositorySkillsPath = fileURLToPath(new URL('../../../../pi/skills', import.meta.url));
const skillsPath = process.env.NEO_PI_SKILLS_DIR
    ?? (existsSync(bundledSkillsPath) ? bundledSkillsPath : repositorySkillsPath);
const atxEnabled = process.env.NEO_PI_ATX_ENABLED === '1';
const atxModel = process.env.NEO_PI_ATX_MODEL ?? 'claude-opus-4-8';

const manager = new PiBridgeManager({
    executable: process.env.PI_EXECUTABLE,
    atmExecutable: process.env.ATM_EXECUTABLE,
    atmExtensionPath,
    atxExtensionPath: atxEnabled ? atxExtensionPath : undefined,
    providerExtensionPath: process.env.NEO_PI_PROVIDER_EXTENSION,
    skillPaths: [skillsPath],
    defaultModel: atxEnabled ? { provider: 'atx', id: atxModel } : undefined,
});

const activeRuns = new Map<string, { userId: string; stateDir: string; sessionId: string }>();

export function isPiRpcChatEnabled(requestedRuntime?: unknown): boolean {
    void requestedRuntime;
    return true;
}

export async function runPiChat(input: {
    userId: string;
    stateDir: string;
    workspaceRoot: string;
    sessionId: string;
    runId: string;
    message: string;
    model?: string;
    signal: AbortSignal;
    send: (event: unknown) => void;
}): Promise<void> {
    const state = createPiSseAdapterState();
    let assistantText = '';
    let citations: MessageCitation[] = [];
    activeRuns.set(input.runId, { userId: input.userId, stateDir: input.stateDir, sessionId: input.sessionId });
    try {
        await messageAdd(input.sessionId, input.userId, 'user', input.message);
        await manager.run({
            stateDir: input.stateDir,
            workspaceRoot: input.workspaceRoot,
            neoSessionId: input.sessionId,
            message: input.message,
            model: resolvePiModel(input.model),
            signal: input.signal,
            onEvent: (event) => {
                if (event.type === 'message_update') {
                    const update = event.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
                    if (update?.type === 'text_delta' && typeof update.delta === 'string') assistantText += update.delta;
                }
                if (event.type === 'tool_execution_end' && event.toolName === 'artifact_save') {
                    citations = mergeCitations(citations, artifactCitations(event.result));
                }
                if (event.type === 'tool_execution_end' && event.toolName === 'knowledge_search') {
                    citations = mergeCitations(citations, knowledgeSearchCitations(event.result));
                }
                const chunk = mapPiEventToSse(event, state);
                if (chunk?.type === 'done') return;
                if (chunk) input.send({ ...chunk, runId: input.runId });
            },
        });
        if (assistantText.trim()) {
            await messageAdd(input.sessionId, input.userId, 'assistant', assistantText, undefined, { citations });
        }
        if (!input.signal.aborted) {
            if (citations.length > 0) input.send({ type: 'citations', citations, runId: input.runId });
            input.send({ type: 'done', runId: input.runId });
        }
    } finally {
        activeRuns.delete(input.runId);
    }
}

function resolvePiModel(model: string | undefined): { provider: string; id: string } | undefined {
    if (!model) return undefined;
    const slash = model.indexOf('/');
    if (slash > 0 && slash < model.length - 1) {
        return { provider: model.slice(0, slash), id: model.slice(slash + 1) };
    }
    const provider = process.env.NEO_PI_PROVIDER;
    return provider ? { provider, id: model } : undefined;
}

export function artifactCitations(result: unknown): MessageCitation[] {
    const details = (result as { details?: { metadata?: { sources?: unknown } } } | undefined)?.details;
    const sources = details?.metadata?.sources;
    if (!Array.isArray(sources)) return [];
    return sources.flatMap((source, index) => {
        if (typeof source !== 'object' || source === null) return [];
        const row = source as { documentId?: unknown; path?: unknown; lineStart?: unknown; lineEnd?: unknown; citation?: unknown };
        if (typeof row.documentId !== 'string') return [];
        const path = typeof row.path === 'string' ? row.path : row.documentId;
        const start = typeof row.lineStart === 'number' ? row.lineStart : undefined;
        const end = typeof row.lineEnd === 'number' ? row.lineEnd : start;
        const sourceId = start !== undefined ? `${row.documentId}#L${start}-L${end}` : row.documentId;
        return [{
            n: typeof row.citation === 'number' ? row.citation : index + 1,
            sourceId,
            title: path,
            ...(start !== undefined ? { snippet: `${path}:L${start}-L${end}` } : {}),
        }];
    });
}

export function knowledgeSearchCitations(result: unknown): MessageCitation[] {
    const details = (result as { details?: unknown } | undefined)?.details;
    if (!Array.isArray(details)) return [];
    return details.flatMap((value, index) => {
        if (typeof value !== 'object' || value === null) return [];
        const hit = value as { document_id?: unknown; relative_path?: unknown; title?: unknown; snippet?: unknown; line_start?: unknown; line_end?: unknown; citation?: unknown };
        if (typeof hit.document_id !== 'string') return [];
        const path = typeof hit.relative_path === 'string' ? hit.relative_path : hit.document_id;
        const start = typeof hit.line_start === 'number' ? hit.line_start : undefined;
        const end = typeof hit.line_end === 'number' ? hit.line_end : start;
        const sourceId = start !== undefined ? `${hit.document_id}#L${start}-L${end}` : hit.document_id;
        return [{
            n: parseCitationNumber(hit.citation) ?? index + 1,
            sourceId,
            title: typeof hit.title === 'string' ? hit.title : path,
            ...(typeof hit.snippet === 'string' ? { snippet: hit.snippet } : start !== undefined ? { snippet: `${path}:L${start}-L${end}` } : {}),
        }];
    });
}

function mergeCitations(current: MessageCitation[], incoming: MessageCitation[]): MessageCitation[] {
    const merged = [...current];
    for (const citation of incoming) {
        if (!merged.some((item) => item.sourceId === citation.sourceId)) merged.push(citation);
    }
    return merged.sort((a, b) => a.n - b.n);
}

function parseCitationNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (typeof value !== 'string') return undefined;
    const match = value.match(/^【(\d+)】$/);
    if (!match) return undefined;
    const parsed = Number(match[1]);
    return parsed > 0 ? parsed : undefined;
}

export async function abortPiRun(runId: string, userId: string): Promise<boolean> {
    const run = activeRuns.get(runId);
    if (!run || run.userId !== userId) return false;
    return manager.abort(run.stateDir, run.sessionId);
}

export async function runPiContentSkill(input: {
    stateDir: string;
    workspaceRoot: string;
    sessionId: string;
    skill: 'notebook-report' | 'article-draft' | 'news-brief';
    request: string;
    model?: string;
}): Promise<{ metadata: { id: string; title: string; createdAt: string }; path: string }> {
    let artifact: { metadata: { id: string; title: string; createdAt: string }; path: string } | undefined;
    await manager.run({
        stateDir: input.stateDir,
        workspaceRoot: input.workspaceRoot,
        neoSessionId: input.sessionId,
        message: `/skill:${input.skill} ${input.request}`,
        model: resolvePiModel(input.model),
        onEvent: (event) => {
            if (event.type !== 'tool_execution_end' || event.toolName !== 'artifact_save') return;
            const details = (event.result as { details?: unknown } | undefined)?.details;
            if (isSavedArtifact(details)) artifact = details;
        },
    });
    if (!artifact) throw new Error(`${input.skill} completed without artifact_save`);
    return artifact;
}

export async function runPiTextTask(input: {
    stateDir: string;
    workspaceRoot: string;
    sessionId: string;
    request: string;
    model?: string;
}): Promise<string> {
    let text = '';
    await manager.run({
        stateDir: input.stateDir,
        workspaceRoot: input.workspaceRoot,
        neoSessionId: input.sessionId,
        message: input.request,
        model: resolvePiModel(input.model),
        onEvent: (event) => {
            if (event.type !== 'message_update') return;
            const update = event.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
            if (update?.type === 'text_delta' && typeof update.delta === 'string') text += update.delta;
        },
    });
    return text.trim();
}

function isSavedArtifact(value: unknown): value is { metadata: { id: string; title: string; createdAt: string }; path: string } {
    if (typeof value !== 'object' || value === null) return false;
    const artifact = value as { metadata?: unknown; path?: unknown };
    if (typeof artifact.path !== 'string' || typeof artifact.metadata !== 'object' || artifact.metadata === null) return false;
    const metadata = artifact.metadata as { id?: unknown; title?: unknown; createdAt?: unknown };
    return typeof metadata.id === 'string' && typeof metadata.title === 'string' && typeof metadata.createdAt === 'string';
}

export async function shutdownPiBridges(): Promise<void> {
    activeRuns.clear();
    await manager.shutdown();
}
