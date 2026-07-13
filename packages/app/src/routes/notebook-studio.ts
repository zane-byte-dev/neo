/**
 * src/routes/notebook-studio.ts — AI generation routes for notebooks.
 *
 * Handles: overview, artifacts (mindmap, report, audio), and note quick-actions.
 */
import type Router from '@koa/router';
import {
    nbListArtifacts,
    nbGetArtifact,
    nbDeleteArtifact,
    nbListNotes,
    nbSaveNote,
    nbSaveArtifact,
    type ArtifactType,
} from '@neo/agent/services/notebook-service.js';
import {
    generateNotebookOverview,
    generateMindMap,
    generateReport,
    generateAudioScript,
    runNoteQuickAction,
    type ReportType,
    type NoteQuickAction,
} from '../services/notebook-ai.js';
import { calcUser } from '@neo/agent/services/user-service.js';
import { promises as fs } from 'node:fs';
import { isPiRpcChatEnabled, runPiContentSkill } from '../services/pi-chat.js';

function extractModel(body: Record<string, unknown>): string | undefined {
    return typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
}

// ── GET /api/notebook/studio — Read-only studio queries ─────────────────────

export function notebookStudioGet(router: Router): void {
    router.get('/api/notebook/studio', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;

        switch (q.action) {
            case 'artifacts': {
                const nb = q.notebook?.trim();
                if (!nb) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }
                const type = (q.type?.trim() || undefined) as ArtifactType | undefined;
                ctx.body = nbListArtifacts(workDir, nb, type, stateDir);
                break;
            }
            case 'artifact': {
                const nb = q.notebook?.trim();
                const id = q.id?.trim();
                if (!nb || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }
                const a = nbGetArtifact(workDir, nb, id, stateDir);
                if (!a) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
                ctx.body = a;
                break;
            }
            default:
                ctx.status = 400;
                ctx.body = { error: `Unknown studio action: ${q.action ?? '(none)'}` };
        }
    });
}

// ── POST /api/notebook/overview — Generate notebook overview ────────────────

export function notebookOverview(router: Router): void {
    router.post('/api/notebook/overview', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        if (!notebook) { ctx.status = 400; ctx.body = { error: 'notebook required' }; return; }

        const sourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined;
        try {
            const overview = await generateNotebookOverview(workDir, notebook, sourceIds, extractModel(body), stateDir);
            ctx.body = { overview };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

// ── POST /api/notebook/artifact — Generate artifact (mindmap/report/audio) ──

export function notebookGenerateArtifact(router: Router): void {
    router.post('/api/notebook/artifact', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const type = typeof body.type === 'string' ? body.type : '';
        if (!notebook || !type) { ctx.status = 400; ctx.body = { error: 'notebook + type required' }; return; }

        const sourceIds = Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined;
        const primaryArticleId = typeof body.primaryArticleId === 'string' && body.primaryArticleId.trim()
            ? body.primaryArticleId.trim()
            : undefined;

        try {
            let artifact;
            if (type === 'mindmap') {
                const topic = typeof body.topic === 'string' ? body.topic : undefined;
                artifact = await generateMindMap(workDir, notebook, sourceIds, topic, extractModel(body), stateDir, { primaryArticleId });
            } else if (type === 'report') {
                const subtype = (typeof body.subtype === 'string' ? body.subtype : 'briefing') as ReportType;
                const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt : undefined;
                const title = typeof body.title === 'string' ? body.title : undefined;
                if (isPiRpcChatEnabled(body.runtime)) {
                    const saved = await runPiContentSkill({
                        stateDir,
                        workspaceRoot: workDir,
                        sessionId: `studio:${notebook}:report`,
                        skill: 'notebook-report',
                        model: extractModel(body),
                        request: `为 Notebook“${notebook}”生成 ${subtype} 报告。${title ? `标题偏好：${title}。` : ''}${customPrompt ? `补充要求：${customPrompt}` : ''}${sourceIds?.length ? `优先使用来源 ID：${sourceIds.join(', ')}。` : ''}`,
                    });
                    const markdown = stripAtmArtifactFrontmatter(await fs.readFile(saved.path, 'utf8'));
                    artifact = nbSaveArtifact(workDir, notebook, {
                        id: saved.metadata.id,
                        type: 'report',
                        subtype,
                        title: saved.metadata.title,
                        data: { markdown, artifactPath: saved.path },
                        sourceIds,
                        primaryArticleId,
                    }, stateDir);
                } else {
                    artifact = await generateReport(workDir, notebook, subtype, { sourceIds, customPrompt, title, model: extractModel(body), primaryArticleId }, stateDir);
                }
            } else if (type === 'audio') {
                const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt : undefined;
                const audioMode = body.audioMode === 'single' || body.audioMode === 'dialogue'
                    ? body.audioMode
                    : undefined;
                artifact = await generateAudioScript(workDir, notebook, sourceIds, extractModel(body), stateDir, { primaryArticleId, customPrompt, audioMode });
            } else {
                ctx.status = 400; ctx.body = { error: `Unknown artifact type: ${type}` }; return;
            }
            ctx.body = artifact;
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}

function stripAtmArtifactFrontmatter(markdown: string): string {
    if (!markdown.startsWith('---\n')) return markdown;
    const end = markdown.indexOf('\n---\n', 4);
    return end >= 0 ? markdown.slice(end + 5).trimStart() : markdown;
}

// ── DELETE /api/notebook/artifact — Delete artifact ─────────────────────────

export function notebookDeleteArtifact(router: Router): void {
    router.delete('/api/notebook/artifact', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const notebook = q.notebook?.trim();
        const id = q.id?.trim();
        if (!notebook || !id) { ctx.status = 400; ctx.body = { error: 'notebook + id required' }; return; }
        if (!nbDeleteArtifact(workDir, notebook, id, stateDir)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── POST /api/notebook/note/quick-action — AI note actions ──────────────────

export function notebookNoteQuickAction(router: Router): void {
    router.post('/api/notebook/note/quick-action', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir, stateDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const notebook = typeof body.notebook === 'string' ? body.notebook.trim() : '';
        const action = typeof body.action === 'string' ? body.action as NoteQuickAction : 'merge';
        const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
        if (!notebook || !ids.length) { ctx.status = 400; ctx.body = { error: 'notebook + ids required' }; return; }

        const allNotes = nbListNotes(workDir, notebook, stateDir);
        const selected = allNotes.filter(n => ids.includes(n.id));
        if (!selected.length) { ctx.status = 404; ctx.body = { error: 'No matching notes' }; return; }

        try {
            const result = await runNoteQuickAction(
                action,
                selected.map(n => ({ title: n.title, content: n.content })),
                extractModel(body),
                { workDir, stateDir, sessionId: `studio:${notebook}:note:${action}` },
            );
            const saved = nbSaveNote(workDir, notebook, {
                title: `${action} · ${new Date().toLocaleString('zh-CN')}`,
                content: result,
                source: 'ai-quick-action',
            }, stateDir);
            ctx.body = saved;
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}
