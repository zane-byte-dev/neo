/**
 * openclaw-skills.ts — Discovers and loads OpenClaw skills from ~/.openclaw/workspace/skills/.
 *
 * Each skill is a directory containing:
 *   - SKILL.md  — YAML frontmatter (name, description) + instructions body
 *   - .skill-version (optional)
 *   - references/ (optional)
 *
 * Skills are injected into the system prompt so the agent knows how/when to use them.
 */

import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { log } from '../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpenClawSkill {
    name: string;
    version: string;
    description: string;
    description_zh?: string;
    /** Full SKILL.md body (after frontmatter) */
    instructions: string;
    /** Absolute path to the skill directory */
    dirPath: string;
}

// ── Frontmatter parser ────────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: raw };

    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        meta[key] = val;
    }
    return { meta, body: match[2] };
}

// ── Skill loader ──────────────────────────────────────────────────────────────

/**
 * Discover all OpenClaw skills from the given base directory.
 * Defaults to ~/.openclaw/workspace/skills/
 */
export async function loadOpenClawSkills(baseDir?: string): Promise<OpenClawSkill[]> {
    const skillsDir = baseDir ?? join(homedir(), '.openclaw', 'workspace', 'skills');

    let entries: string[];
    try {
        const dirEnts = await fs.readdir(skillsDir, { withFileTypes: true });
        entries = dirEnts.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        // Directory doesn't exist or is unreadable
        return [];
    }

    const skills: OpenClawSkill[] = [];

    for (const dirName of entries) {
        const dirPath = join(skillsDir, dirName);
        const skillMdPath = join(dirPath, 'SKILL.md');

        try {
            const raw = await fs.readFile(skillMdPath, 'utf8');
            const { meta, body } = parseFrontmatter(raw);

            skills.push({
                name: meta.name || dirName,
                version: meta.version || 'unknown',
                description: meta.description || '',
                description_zh: meta.description_zh || undefined,
                instructions: body.trim(),
                dirPath,
            });
        } catch {
            // Skip directories without a valid SKILL.md
            log.warn('OpenClaw', `Skipped skill dir (no SKILL.md): ${dirPath}`);
        }
    }

    return skills;
}

// ── Prompt injection ──────────────────────────────────────────────────────────

/**
 * Format loaded skills into a system prompt section.
 */
export function formatSkillsPrompt(skills: OpenClawSkill[]): string {
    if (skills.length === 0) return '';

    const parts: string[] = [
        '# OpenClaw Skills',
        '',
        '以下是已安装的 OpenClaw 技能扩展。根据用户请求的场景自动判断是否需要使用对应技能。',
        '',
        '## 全局规则',
        '',
        '- 当 skill 需要用 `-o` 输出文件时，**必须写到 `/tmp/` 目录**（如 `-o /tmp/search_results.json`），不要写到工作目录。',
        '- 读取完临时文件后无需手动清理，系统会自动回收。',
        '',
    ];

    for (const skill of skills) {
        const desc = skill.description_zh || skill.description;
        parts.push(`## Skill: ${skill.name} (v${skill.version})`);
        if (desc) parts.push(`> ${desc}`);
        parts.push('');
        parts.push(skill.instructions);
        parts.push('');
        parts.push('---');
        parts.push('');
    }

    return parts.join('\n');
}
