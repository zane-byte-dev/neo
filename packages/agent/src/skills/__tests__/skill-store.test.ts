import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    createSkillFromRawContent,
    deleteSkillByName,
    findSkillFile,
    saveSkillFromRawContent,
    scanAllSkills,
    setSkillEnabled,
} from '../skill-store.js';

let stateDir: string;

beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'neo-skill-store-'));
});

afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
});

function skillBody(name: string, extraFrontmatter = ''): string {
    return `---\nname: ${name}\ndescription: ${name} skill\n${extraFrontmatter}---\nUse this skill.\n`;
}

describe('skill-store', () => {
    it('creates a new skill and rejects duplicates', async () => {
        const record = await createSkillFromRawContent(stateDir, skillBody('draft_reply'));
        expect(record.skill.frontmatter.name).toBe('draft_reply');
        await expect(createSkillFromRawContent(stateDir, skillBody('draft_reply')))
            .rejects.toThrow('already exists');
    });

    it('upserts a skill while enforcing the requested name', async () => {
        await createSkillFromRawContent(stateDir, skillBody('draft_reply'));

        const updated = await saveSkillFromRawContent(
            stateDir,
            skillBody('draft_reply', 'tags:\n  - writing\n'),
            'draft_reply',
        );

        expect(updated.skill.frontmatter.tags).toEqual(['writing']);
        await expect(saveSkillFromRawContent(stateDir, skillBody('other_name'), 'draft_reply'))
            .rejects.toThrow('does not match requested name');
    });

    it('finds nested skills and includes disabled ones when scanning', async () => {
        const nestedDir = join(stateDir, 'skills', 'xifeng');
        await fs.mkdir(nestedDir, { recursive: true });
        await fs.writeFile(join(nestedDir, 'skill.md'), skillBody('xifeng', 'enabled: false\n'), 'utf8');

        expect(await findSkillFile(stateDir, 'xifeng')).toBe(join(nestedDir, 'skill.md'));
        const names = (await scanAllSkills(stateDir)).map((skill) => skill.frontmatter.name);
        expect(names).toContain('xifeng');
    });

    it('toggles enabled state and deletes a skill', async () => {
        await createSkillFromRawContent(stateDir, skillBody('brief_reply'));

        const disabled = await setSkillEnabled(stateDir, 'brief_reply', false);
        expect(disabled.skill.frontmatter.enabled).toBe(false);

        expect(await deleteSkillByName(stateDir, 'brief_reply')).toBe(true);
        expect(await deleteSkillByName(stateDir, 'brief_reply')).toBe(false);
    });
});