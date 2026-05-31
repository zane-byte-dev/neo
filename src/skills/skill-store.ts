import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseSkillFile } from './skill-parser.js';
import type { SkillDefinition } from './skill-parser.js';

const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))([\s\S]*)$/;

export interface SkillFileRecord {
    skill: SkillDefinition;
    rawContent: string;
}

function assertValidName(name: string): void {
    if (!SKILL_NAME_RE.test(name)) {
        throw new Error(`Skill name "${name}" contains invalid characters (a-z, 0-9, _ and - only)`);
    }
}

function parseIncomingSkill(rawContent: string, filePath: string): SkillDefinition {
    if (!rawContent.trim()) throw new Error('rawContent is required');
    const skill = parseSkillFile(rawContent, filePath);
    assertValidName(skill.frontmatter.name);
    return skill;
}

export function isValidSkillName(name: string): boolean {
    return SKILL_NAME_RE.test(name);
}

function skillsDirPath(stateDir: string): string {
    return join(stateDir, 'skills');
}

function skillFilePath(stateDir: string, name: string): string {
    return join(skillsDirPath(stateDir), `${name}.skill.md`);
}

export async function findSkillFile(stateDir: string, name: string): Promise<string | null> {
    assertValidName(name);

    const flat = skillFilePath(stateDir, name);
    try {
        const s = await stat(flat);
        if (s.isFile()) return flat;
    } catch { /* not found */ }

    const nested = join(skillsDirPath(stateDir), name, 'skill.md');
    try {
        const s = await stat(nested);
        if (s.isFile()) return nested;
    } catch { /* not found */ }

    return null;
}

export async function scanAllSkills(stateDir: string): Promise<SkillDefinition[]> {
    let entries;
    try {
        entries = await readdir(skillsDirPath(stateDir), { withFileTypes: true, encoding: 'utf-8' });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }

    const candidatePaths: string[] = [];
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.skill.md')) {
            candidatePaths.push(join(skillsDirPath(stateDir), entry.name));
        } else if (entry.isDirectory()) {
            const nested = join(skillsDirPath(stateDir), entry.name, 'skill.md');
            try {
                const s = await stat(nested);
                if (s.isFile()) candidatePaths.push(nested);
            } catch { /* no nested skill */ }
        }
    }

    const skills: SkillDefinition[] = [];
    for (const filePath of candidatePaths.sort()) {
        try {
            const rawContent = await readFile(filePath, 'utf8');
            skills.push(parseSkillFile(rawContent, filePath));
        } catch { /* skip invalid skills while listing */ }
    }
    return skills;
}

export async function getSkillRecord(stateDir: string, name: string): Promise<SkillFileRecord | null> {
    const filePath = await findSkillFile(stateDir, name);
    if (!filePath) return null;

    const rawContent = await readFile(filePath, 'utf8');
    return {
        skill: parseSkillFile(rawContent, filePath),
        rawContent,
    };
}

export async function createSkillFromRawContent(stateDir: string, rawContent: string): Promise<SkillFileRecord> {
    const parsed = parseIncomingSkill(rawContent, '<new>');
    const name = parsed.frontmatter.name;

    if (await findSkillFile(stateDir, name)) {
        throw new Error(`Skill "${name}" already exists`);
    }

    await mkdir(skillsDirPath(stateDir), { recursive: true });
    const filePath = skillFilePath(stateDir, name);
    await writeFile(filePath, rawContent, 'utf8');

    return {
        skill: parseSkillFile(rawContent, filePath),
        rawContent,
    };
}

export async function saveSkillFromRawContent(
    stateDir: string,
    rawContent: string,
    expectedName?: string,
): Promise<SkillFileRecord> {
    const parsed = parseIncomingSkill(rawContent, expectedName ?? '<skill>');
    if (expectedName && parsed.frontmatter.name !== expectedName) {
        throw new Error(`Frontmatter name "${parsed.frontmatter.name}" does not match requested name "${expectedName}"`);
    }

    await mkdir(skillsDirPath(stateDir), { recursive: true });
    const filePath = (await findSkillFile(stateDir, parsed.frontmatter.name))
        ?? skillFilePath(stateDir, parsed.frontmatter.name);
    await writeFile(filePath, rawContent, 'utf8');

    return {
        skill: parseSkillFile(rawContent, filePath),
        rawContent,
    };
}

export async function setSkillEnabled(
    stateDir: string,
    name: string,
    enabled: boolean,
): Promise<SkillFileRecord> {
    const record = await getSkillRecord(stateDir, name);
    if (!record) throw new Error(`Skill "${name}" not found`);

    const match = record.rawContent.match(FRONTMATTER_RE);
    if (!match) throw new Error('Skill file has no valid YAML frontmatter');

    const [, open, yaml, close, rest] = match;
    const enabledLine = `enabled: ${enabled}`;
    const newYaml = /^enabled:/m.test(yaml)
        ? yaml.replace(/^enabled:.*$/m, enabledLine)
        : yaml.trimEnd() + '\n' + enabledLine;
    const rawContent = open + newYaml + close + rest;

    await writeFile(record.skill.filePath, rawContent, 'utf8');
    return {
        skill: parseSkillFile(rawContent, record.skill.filePath),
        rawContent,
    };
}

export async function deleteSkillByName(stateDir: string, name: string): Promise<boolean> {
    const filePath = await findSkillFile(stateDir, name);
    if (!filePath) return false;
    await unlink(filePath);
    return true;
}