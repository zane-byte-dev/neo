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
import { mkdir, readFile, writeFile, unlink, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type Router from '@koa/router';
import { calcUser, invalidateUserCache } from '../services/user-service.js';
import { parseSkillFile } from '../skills/skill-parser.js';
import type { SkillDefinition } from '../skills/skill-parser.js';

const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isValidName(name: string): boolean {
    return SKILL_NAME_RE.test(name);
}

function skillFilePath(skillsDir: string, name: string): string {
    return join(skillsDir, `${name}.skill.md`);
}

/**
 * Locate the actual file for a skill by checking both supported layouts:
 *   - Flat:   {skillsDir}/{name}.skill.md
 *   - Nested: {skillsDir}/{name}/skill.md
 * Returns the path if found, null otherwise.
 */
async function findSkillFile(skillsDir: string, name: string): Promise<string | null> {
    const flat = skillFilePath(skillsDir, name);
    try {
        const s = await stat(flat);
        if (s.isFile()) return flat;
    } catch { /* not found */ }

    const nested = join(skillsDir, name, 'skill.md');
    try {
        const s = await stat(nested);
        if (s.isFile()) return nested;
    } catch { /* not found */ }

    return null;
}

/**
 * Scan all skill files in skillsDir (both layouts, including disabled).
 * Never throws — missing directory returns [].
 */
async function _scanAllSkills(skillsDir: string): Promise<SkillDefinition[]> {
    let entries: { name: string; isFile(): boolean }[];
    try {
        entries = await readdir(skillsDir, { withFileTypes: true, encoding: 'utf-8' }) as unknown as { name: string; isFile(): boolean }[];
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }

    const candidatePaths: string[] = [];
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.skill.md')) {
            candidatePaths.push(join(skillsDir, entry.name));
        } else if (!entry.isFile()) {
            const nested = join(skillsDir, entry.name, 'skill.md');
            try {
                const s = await stat(nested);
                if (s.isFile()) candidatePaths.push(nested);
            } catch { /* no skill.md */ }
        }
    }

    const results: SkillDefinition[] = [];
    for (const filePath of candidatePaths) {
        try {
            const content = await readFile(filePath, 'utf-8');
            results.push(parseSkillFile(content, filePath));
        } catch { /* skip unparseable files */ }
    }
    return results;
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
        // Scan the skills dir directly so disabled skills are also included in the list.
        const skillsDir = join(stateDir, 'skills');
        const allSkills = await _scanAllSkills(skillsDir);
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
        // Read directly from file — do NOT go through the registry because
        // the registry skips disabled skills and may miss nested layout files.
        const skillsDir = join(stateDir, 'skills');
        const filePath = await findSkillFile(skillsDir, name);
        if (!filePath) {
            ctx.status = 404;
            ctx.body = { error: `Skill "${name}" not found` };
            return;
        }
        const rawContent = await readFile(filePath, 'utf8');
        const skill = parseSkillFile(rawContent, filePath);
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

        // Check if already exists in either layout
        const existing = await findSkillFile(skillsDir, name);
        if (existing) {
            ctx.status = 409;
            ctx.body = { error: `Skill "${name}" already exists` };
            return;
        }

        const filePath = skillFilePath(skillsDir, name);
        await writeFile(filePath, rawContent, 'utf8');
        invalidateUserCache(userId);
        ctx.status = 201;
        ctx.body = { ok: true, name };
    });

    // ── Toggle skill enabled/disabled ────────────────────────────────────────
    router.patch('/api/skills/:name', async (ctx) => {
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
        if (typeof body.enabled !== 'boolean') {
            ctx.status = 400;
            ctx.body = { error: '`enabled` (boolean) is required' };
            return;
        }
        const enabled: boolean = body.enabled;

        const skillsDir = join(stateDir, 'skills');
        const filePath = await findSkillFile(skillsDir, name);
        if (!filePath) {
            ctx.status = 404;
            ctx.body = { error: `Skill "${name}" not found` };
            return;
        }

        const raw = await readFile(filePath, 'utf8');

        // Patch the enabled field inside the YAML frontmatter block
        const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))([\s\S]*)$/;
        const m = raw.match(FRONTMATTER_RE);
        if (!m) {
            ctx.status = 400;
            ctx.body = { error: 'Skill file has no valid YAML frontmatter' };
            return;
        }
        const [, open, yaml, close, rest] = m;

        // Replace existing `enabled:` line or append it
        const enabledLine = `enabled: ${enabled}`;
        let newYaml: string;
        if (/^enabled:/m.test(yaml)) {
            newYaml = yaml.replace(/^enabled:.*$/m, enabledLine);
        } else {
            newYaml = yaml.trimEnd() + '\n' + enabledLine;
        }

        await writeFile(filePath, open + newYaml + close + rest, 'utf8');
        invalidateUserCache(userId);
        ctx.body = { ok: true, name, enabled };
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
        // Write to wherever the file already lives; fall back to flat layout for new files
        const existingPath = await findSkillFile(skillsDir, name);
        const filePath = existingPath ?? skillFilePath(skillsDir, name);
        await mkdir(join(filePath, '..'), { recursive: true });
        await writeFile(filePath, rawContent, 'utf8');
        invalidateUserCache(userId);
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
        const filePath = await findSkillFile(skillsDir, name);
        if (!filePath) {
            ctx.status = 404;
            ctx.body = { error: `Skill "${name}" not found` };
            return;
        }
        await unlink(filePath);
        invalidateUserCache(userId);
        ctx.body = { ok: true };
    });
}

export function register(router: Router): void {
    skillsRoute(router);
}
