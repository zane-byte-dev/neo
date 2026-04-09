/**
 * skill-registry.ts — Per-user skill registry.
 *
 * Scans {baseDir}/resource/workspace/{userId}/skills/*.skill.md,
 * parses each file, and exposes:
 *   - get(name)                → SkillDefinition | undefined
 *   - list()                   → SkillDefinition[]
 *   - toFunctionDeclarations() → FunctionDeclaration[] (for Gemini tool schema)
 */

import { readdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseSkillFile } from './skill-parser.js';
import type { SkillDefinition } from './skill-parser.js';
import type { FunctionDeclaration } from '../utils/gemini-types.js';

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

    /** Build Gemini FunctionDeclaration array from all registered skills. */
    toFunctionDeclarations(): FunctionDeclaration[] {
        return this.list().map(s => ({
            name: s.frontmatter.name,
            description: s.frontmatter.description,
            parameters: s.frontmatter.parameters ?? {
                type: 'object',
                properties: {},
            },
        }));
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
 * Skills directory: {projectRoot}/resource/workspace/{userId}/skills/
 *
 * @param userId     The user identifier (matches resource/workspace/{userId}/)
 * @param projectRoot Absolute path to the project root (passed in to avoid import.meta coupling)
 */
export async function loadUserSkills(
    userId: string,
    projectRoot: string,
): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    const skillsDir = resolve(projectRoot, 'resource', 'workspace', userId, 'skills');

    let entries: { name: string; isFile(): boolean }[];
    try {
        entries = await readdir(skillsDir, { withFileTypes: true, encoding: 'utf-8' }) as unknown as { name: string; isFile(): boolean }[];
    } catch (err: unknown) {
        // Skills directory doesn't exist yet — that's fine, return empty registry
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            console.log(`[SkillRegistry] No skills directory for user "${userId}" (${skillsDir})`);
            return registry;
        }
        throw err;
    }

    let loaded = 0;
    let skipped = 0;

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.skill.md')) continue;

        const filePath = join(skillsDir, entry.name);
        try {
            const content = await readFile(filePath, 'utf-8');
            const skill = parseSkillFile(content, filePath);

            if (skill.frontmatter.enabled === false) {
                console.log(`[SkillRegistry] ⏭  Skipped (disabled): ${skill.frontmatter.name}`);
                skipped++;
                continue;
            }

            registry.register(skill);
            console.log(`[SkillRegistry] 🧠 Loaded: ${skill.frontmatter.name} (${filePath})`);
            loaded++;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[SkillRegistry] ❌ Failed to load ${filePath}: ${msg}`);
        }
    }

    console.log(`[SkillRegistry] ✅ ${loaded} skill(s) loaded for "${userId}" (${skipped} skipped)`);
    return registry;
}
