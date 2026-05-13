import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillRegistry, loadUserSkills } from '../skill-registry.js';
import type { SkillDefinition } from '../skill-parser.js';

let work: string;

beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'skreg-')); });
afterEach(() => { rmSync(work, { recursive: true, force: true }); });

const SKILL_BODY = (name: string, enabled?: boolean) => `---
name: ${name}
description: ${name} skill
${enabled === undefined ? '' : `enabled: ${enabled}\n`}---
do something
`;

describe('SkillRegistry class', () => {
    it('register/get/unregister/list/size work', () => {
        const r = new SkillRegistry();
        const sk = { frontmatter: { name: 'foo' } } as unknown as SkillDefinition;
        r.register(sk);
        expect(r.size).toBe(1);
        expect(r.get('foo')).toBe(sk);
        expect(r.unregister('foo')).toBe(true);
        expect(r.unregister('foo')).toBe(false);
        r.register(sk);
        expect(r.list()).toEqual([sk]);
        expect(r.get('missing')).toBeUndefined();
    });
});

describe('loadUserSkills', () => {
    it('returns an empty registry when skills dir does not exist', async () => {
        const reg = await loadUserSkills(work, 'u1');
        expect(reg.size).toBe(0);
    });

    it('loads flat *.skill.md files', async () => {
        const sd = join(work, 'skills');
        await fs.mkdir(sd, { recursive: true });
        await fs.writeFile(join(sd, 'alpha.skill.md'), SKILL_BODY('alpha'), 'utf8');
        await fs.writeFile(join(sd, 'beta.skill.md'), SKILL_BODY('beta'), 'utf8');

        const reg = await loadUserSkills(work, 'u1');
        expect(reg.size).toBe(2);
        expect(reg.get('alpha')).toBeDefined();
        expect(reg.get('beta')).toBeDefined();
    });

    it('loads nested {name}/skill.md', async () => {
        const sub = join(work, 'skills', 'gamma');
        await fs.mkdir(sub, { recursive: true });
        await fs.writeFile(join(sub, 'skill.md'), SKILL_BODY('gamma'), 'utf8');

        const reg = await loadUserSkills(work, 'u1');
        expect(reg.get('gamma')).toBeDefined();
    });

    it('skips disabled skills', async () => {
        const sd = join(work, 'skills');
        await fs.mkdir(sd, { recursive: true });
        await fs.writeFile(join(sd, 'off.skill.md'), SKILL_BODY('off', false), 'utf8');

        const reg = await loadUserSkills(work, 'u1');
        expect(reg.get('off')).toBeUndefined();
    });

    it('continues when an individual skill file fails to parse', async () => {
        const sd = join(work, 'skills');
        await fs.mkdir(sd, { recursive: true });
        await fs.writeFile(join(sd, 'bad.skill.md'), 'no frontmatter at all', 'utf8');
        await fs.writeFile(join(sd, 'good.skill.md'), SKILL_BODY('good'), 'utf8');

        const reg = await loadUserSkills(work, 'u1');
        expect(reg.get('good')).toBeDefined();
    });
});
