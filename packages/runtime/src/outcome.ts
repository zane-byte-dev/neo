import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listRunEvents } from './events.js';
import { artifactsDir } from './paths.js';
import { loadRun } from './store.js';
import type { RunArtifact, RunErrorInfo, RunStatus } from './types.js';
import { generateId } from './internal/id-generator.js';

export interface RunOutcome {
    runId: string;
    status: RunStatus;
    responseText: string;
    responsePreview?: string;
    responseLength?: number;
    finishedAt?: string;
    artifacts: RunArtifact[];
    error?: RunErrorInfo;
}

export async function readRunOutcome(
    workDir: string,
    runId: string,
    opts: { fallbackText?: string } = {},
): Promise<RunOutcome | null> {
    const run = await loadRun(workDir, runId);
    if (!run) return null;

    const events = await listRunEvents(workDir, runId);
    const artifacts = new Map<string, RunArtifact>();
    let responsePreview: string | undefined;
    let responseLength: number | undefined;
    let finishedAt = run.finishedAt;
    let error: RunErrorInfo | undefined = run.lastError;

    for (const event of events) {
        if (event.type === 'artifact_created') {
            artifacts.set(event.payload.artifact.id, event.payload.artifact);
            continue;
        }
        if (event.type === 'run_completed') {
            responsePreview = event.payload.outputPreview;
            responseLength = event.payload.responseLength;
            finishedAt = event.payload.finishedAt;
            continue;
        }
        if (event.type === 'run_failed') {
            error = event.payload.error;
            finishedAt = event.payload.finishedAt;
        }
    }

    return {
        runId,
        status: run.status,
        responseText: opts.fallbackText ?? responsePreview ?? '',
        ...(responsePreview !== undefined && { responsePreview }),
        ...(responseLength !== undefined && { responseLength }),
        ...(finishedAt !== undefined && { finishedAt }),
        artifacts: [...artifacts.values()],
        ...(error !== undefined && { error }),
    };
}

export async function persistImageArtifact(
    workDir: string,
    runId: string,
    data: string,
    mimeType: string,
    title?: string,
): Promise<{ path: string; mimeType: string; title?: string }> {
    const ext = mimeType.includes('png')
        ? 'png'
        : mimeType.includes('webp')
            ? 'webp'
            : mimeType.includes('gif')
                ? 'gif'
                : 'jpg';
    const fileName = `image_${Date.now()}_${generateId()}.${ext}`;
    const dir = artifactsDir(workDir, runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), Buffer.from(data, 'base64'));
    return {
        path: fileName,
        mimeType,
        ...(title !== undefined && { title }),
    };
}

export function renderArtifactReferences(artifacts: RunArtifact[]): string[] {
    return artifacts.flatMap((artifact) => {
        const ref = artifact.url ?? artifact.path;
        if (!ref) return [];
        const label = artifact.title ?? artifact.path ?? artifact.url ?? artifact.kind;
        return [`[${artifact.kind}] ${label}: ${ref}`];
    });
}