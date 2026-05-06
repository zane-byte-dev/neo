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
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type Router from '@koa/router';
import { calcUser } from '../services/user-service.js';
import { loadUserSkills } from '../skills/skill-registry.js';
import { parseSkillFile } from '../skills/skill-parser.js';

const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isValidName(name: string): boolean {
    return SKILL_NAME_RE.test(name);
}

function skillFilePath(skillsDir: string, name: string): string {
    return join(skillsDir, `${name}.skill.md`);
}

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
        const registry = await loadUserSkills(stateDir, userId);
        ctx.body = {
            skills: registry.list().map((s) => ({
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
        if (!isValidName(name)) {
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
        const registry = await loadUserSkills(stateDir, userId);
        const skill = registry.get(name);
        if (!skill) {
            ctx.status = 404;
            ctx.body = { error: `Skill "${name}" not found` };
            return;
        }
        // Return raw file content too, for the editor
        let rawContent = '';
        try {
            rawContent = await readFile(skill.filePath, 'utf8');
        } catch { /* ignore */ }
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
        if (!rawContent.trim()) {
            ctx.status = 400;
            ctx.body = { error: 'rawContent is required' };
            return;
        }

        // Parse to validate & extract name
        let parsed;
        try {
            parsed = parseSkillFile(rawContent, '<new>');
        } catch (err) {
            ctx.status = 400;
            ctx.body = { error: err instanceof Error ? err.message : 'Invalid skill file' };
            return;
        }

        const name = parsed.frontmatter.name;
        if (!isValidName(name)) {
            ctx.status = 400;
            ctx.body = { error: `Skill name "${name}" contains invalid characters (a-z, 0-9, _ and - only)` };
            return;
        }

        const skillsDir = join(stateDir, 'skills');
        await mkdir(skillsDir, { recursive: true });
        const filePath = skillFilePath(skillsDir, name);

        // Check if already exists
        try {
            await readFile(filePath);
            ctx.status = 409;
            ctx.body = { error: `Skill "${name}" already exists` };
            return;
        } catch { /* ok, doesn't exist */ }

        await writeFile(filePath, rawContent, 'utf8');
        ctx.status = 201;
        ctx.body = { ok: true, name };
    });

    // ── Update skill ─────────────────────────────────────────────────────────
    router.put('/api/skills/:name', async (ctx) => {
        const name = ctx.params.name ?? '';
        if (!isValidName(name)) {
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
        if (!rawContent.trim()) {
            ctx.status = 400;
            ctx.body = { error: 'rawContent is required' };
            return;
        }

        // Parse to validate
        let parsed;
        try {
            parsed = parseSkillFile(rawContent, name);
        } catch (err) {
            ctx.status = 400;
            ctx.body = { error: err instanceof Error ? err.message : 'Invalid skill file' };
            return;
        }

        // Name in frontmatter must match URL param
        if (parsed.frontmatter.name !== name) {
            ctx.status = 400;
            ctx.body = { error: `Frontmatter name "${parsed.frontmatter.name}" does not match URL param "${name}"` };
            return;
        }

        const skillsDir = join(stateDir, 'skills');
        await mkdir(skillsDir, { recursive: true });
        const filePath = skillFilePath(skillsDir, name);
        await writeFile(filePath, rawContent, 'utf8');
        ctx.body = { ok: true, name };
    });

    // ── Delete skill ─────────────────────────────────────────────────────────
    router.delete('/api/skills/:name', async (ctx) => {
        const name = ctx.params.name ?? '';
        if (!isValidName(name)) {
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
        const skillsDir = join(stateDir, 'skills');
        const filePath = skillFilePath(skillsDir, name);
        try {
            await unlink(filePath);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                ctx.status = 404;
                ctx.body = { error: `Skill "${name}" not found` };
                return;
            }
            throw err;
        }
        ctx.body = { ok: true };
    });
}

export function register(router: Router): void {
    skillsRoute(router);
}
