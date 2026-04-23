/**
 * skill-registry.ts — Per-user skill registry.
 *
 * Scans {workDir}/.neo/skills/*.skill.md,
 * parses each file, and exposes:
 *   - get(name)   → SkillDefinition | undefined
 *   - list()      → SkillDefinition[]
 */

import { readdir, stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkillFile } from './skill-parser.js';
import type { SkillDefinition } from './skill-parser.js';
import { log } from '../utils/logger.js';

export type { SkillDefinition };

// ── Registry class ────────────────────────────────────────────────────────────

export class SkillRegistry {
    private readonly _skills = new Map<string, SkillDefinition>();

    /** Add a parsed skill to the registry. */
    register(skill: SkillDefinition): void {
        this._skills.set(skill.frontmatter.name, skill);
    }

    /** Look up a skill by its name. */
    get(name: string): SkillDefinition | undefined {
        return this._skills.get(name);
    }

    /** All registered skills. */
    list(): SkillDefinition[] {
        return [...this._skills.values()];
    }

    /** Total number of registered skills. */
    get size(): number {
        return this._skills.size;
    }
}

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Scan the user's skills directory, parse all *.skill.md files, and return
 * a populated SkillRegistry instance.
 *
 * Skills directory: {workDir}/.neo/skills/
 *
 * Supports two file layouts:
 *   - Flat:  skills/brief.skill.md
 *   - Nested: skills/xifeng/skill.md  (subdirectory with skill.md)
 *
 * @param workDir Absolute path to the user's workspace directory
 * @param userId  User identifier used for log messages
 */
export async function loadUserSkills(
    workDir: string,
    userId: string,
): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    const skillsDir = join(workDir, '.neo', 'skills');

    let entries: { name: string; isFile(): boolean }[];
    try {
        entries = await readdir(skillsDir, { withFileTypes: true, encoding: 'utf-8' }) as unknown as { name: string; isFile(): boolean }[];
    } catch (err: unknown) {
        // Skills directory doesn't exist yet — that's fine, return empty registry
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            log.info('SkillRegistry', `No skills directory for user "${userId}" (${skillsDir})`);
            return registry;
        }
        throw err;
    }

    let loaded = 0;
    let skipped = 0;

    // Collect candidate file paths:
    // 1. top-level *.skill.md  (e.g. brief.skill.md)
    // 2. subdirectory skill.md (e.g. xifeng/skill.md)
    const candidatePaths: string[] = [];
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.skill.md')) {
            candidatePaths.push(join(skillsDir, entry.name));
        } else if (!entry.isFile()) {
            // Check for {subdir}/skill.md
            const subSkill = join(skillsDir, entry.name, 'skill.md');
            try {
                await stat(subSkill);
                candidatePaths.push(subSkill);
            } catch { /* no skill.md in this subdir */ }
        }
    }

    for (const filePath of candidatePaths) {
        try {
            const content = await readFile(filePath, 'utf-8');
            const skill = parseSkillFile(content, filePath);

            if (skill.frontmatter.enabled === false) {
                log.info('SkillRegistry', `Skipped (disabled): ${skill.frontmatter.name}`);
                skipped++;
                continue;
            }

            registry.register(skill);
            log.info('SkillRegistry', `Loaded: ${skill.frontmatter.name} (${filePath})`);
            loaded++;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error('SkillRegistry', `Failed to load ${filePath}: ${msg}`);
        }
    }

    log.info('SkillRegistry', `${loaded} skill(s) loaded for "${userId}" (${skipped} skipped)`);
    return registry;
}
