/**
 * skills.ts — REST API for per-user skill management.
 *
 * Routes:
 *   GET    /api/skills           — list all skills (summary)
 *   GET    /api/skills/:name     — get a skill with full body
 *   POST   /api/skills           — create a new skill (.skill.md file)
 *   PUT    /api/skills/:name     — overwrite a skill
 *   DELETE /api/skills/:name     — delete a skill
 */
import { join } from 'node:path';
import type Router from '@koa/router';
import { calcUser, invalidateUserCache } from '@neo/agent/services/user-service.js';
import {
    createSkillFromRawContent,
    deleteSkillByName,
    getSkillRecord,
    isValidSkillName,
    saveSkillFromRawContent,
    scanAllSkills,
    setSkillEnabled,
} from '@neo/agent/skills/skill-store.js';

export function skillsRoute(router: Router): void {
    // ── List skills ──────────────────────────────────────────────────────────
    router.get('/api/skills', async (ctx) => {
        const userId = ctx.state.userId as string;
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir;
        if (!stateDir) {
            ctx.body = { skills: [] };
            return;
        }
        // Scan the skills dir directly so disabled skills are also included in the list.
        const allSkills = await scanAllSkills(stateDir);
        ctx.body = {
            skills: allSkills.map((s) => ({
                name: s.frontmatter.name,
                description: s.frontmatter.description,
                tags: s.frontmatter.tags ?? [],
                version: s.frontmatter.version ?? null,
                enabled: s.frontmatter.enabled !== false,
                hasExecutable: s.executableBlocks.length > 0,
                filePath: s.filePath,
            })),
        };
    });

    // ── Get skill detail (with body) ─────────────────────────────────────────
    router.get('/api/skills/:name', async (ctx) => {
        const name = ctx.params.name ?? '';
        if (!isValidSkillName(name)) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid skill name' };
            return;
        }
        const userId = ctx.state.userId as string;
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir;
        if (!stateDir) {
            ctx.status = 404;
            ctx.body = { error: 'No state directory' };
            return;
        }
        // Read directly from file — do NOT go through the registry because
        // the registry skips disabled skills and may miss nested layout files.
        const record = await getSkillRecord(stateDir, name);
        if (!record) {
            ctx.status = 404;
            ctx.body = { error: `Skill "${name}" not found` };
            return;
        }
        const { skill, rawContent } = record;
        ctx.body = {
            name: skill.frontmatter.name,
            description: skill.frontmatter.description,
            tags: skill.frontmatter.tags ?? [],
            version: skill.frontmatter.version ?? null,
            enabled: skill.frontmatter.enabled !== false,
            body: skill.body,
            executableBlocks: skill.executableBlocks,
            rawContent,
            filePath: skill.filePath,
        };
    });

    // ── Create skill ─────────────────────────────────────────────────────────
    router.post('/api/skills', async (ctx) => {
        const userId = ctx.state.userId as string;
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir;
        if (!stateDir) {
            ctx.status = 500;
            ctx.body = { error: 'No state directory configured' };
            return;
        }

        const body = ctx.request.body as Record<string, unknown>;
        const rawContent = typeof body.rawContent === 'string' ? body.rawContent : '';
        try {
            const record = await createSkillFromRawContent(stateDir, rawContent);
            invalidateUserCache(userId);
            ctx.status = 201;
            ctx.body = { ok: true, name: record.skill.frontmatter.name };
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Invalid skill file';
            ctx.status = msg.includes('already exists') ? 409 : 400;
            ctx.body = { error: msg };
        }
    });

    // ── Toggle skill enabled/disabled ────────────────────────────────────────
    router.patch('/api/skills/:name', async (ctx) => {
        const name = ctx.params.name ?? '';
        if (!isValidSkillName(name)) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid skill name' };
            return;
        }
        const userId = ctx.state.userId as string;
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir;
        if (!stateDir) {
            ctx.status = 500;
            ctx.body = { error: 'No state directory configured' };
            return;
        }

        const body = ctx.request.body as Record<string, unknown>;
        if (typeof body.enabled !== 'boolean') {
            ctx.status = 400;
            ctx.body = { error: '`enabled` (boolean) is required' };
            return;
        }
        const enabled: boolean = body.enabled;

        try {
            await setSkillEnabled(stateDir, name, enabled);
            invalidateUserCache(userId);
            ctx.body = { ok: true, name, enabled };
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to update skill';
            ctx.status = msg.includes('not found') ? 404 : 400;
            ctx.body = { error: msg };
        }
    });

    // ── Update skill ─────────────────────────────────────────────────────────
    router.put('/api/skills/:name', async (ctx) => {
        const name = ctx.params.name ?? '';
        if (!isValidSkillName(name)) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid skill name' };
            return;
        }
        const userId = ctx.state.userId as string;
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir;
        if (!stateDir) {
            ctx.status = 500;
            ctx.body = { error: 'No state directory configured' };
            return;
        }

        const body = ctx.request.body as Record<string, unknown>;
        const rawContent = typeof body.rawContent === 'string' ? body.rawContent : '';
        try {
            await saveSkillFromRawContent(stateDir, rawContent, name);
            invalidateUserCache(userId);
            ctx.body = { ok: true, name };
        } catch (err) {
            ctx.status = 400;
            ctx.body = { error: err instanceof Error ? err.message : 'Invalid skill file' };
        }
    });

    // ── Delete skill ─────────────────────────────────────────────────────────
    router.delete('/api/skills/:name', async (ctx) => {
        const name = ctx.params.name ?? '';
        if (!isValidSkillName(name)) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid skill name' };
            return;
        }
        const userId = ctx.state.userId as string;
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir;
        if (!stateDir) {
            ctx.status = 500;
            ctx.body = { error: 'No state directory configured' };
            return;
        }
        if (!(await deleteSkillByName(stateDir, name))) {
            ctx.status = 404;
            ctx.body = { error: `Skill "${name}" not found` };
            return;
        }
        invalidateUserCache(userId);
        ctx.body = { ok: true };
    });
}

export function register(router: Router): void {
    skillsRoute(router);
}
