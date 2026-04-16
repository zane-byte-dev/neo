import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '../skill-registry.js';
import type { SkillDefinition } from '../skill-parser.js';

function makeSkill(name: string, description = 'desc'): SkillDefinition {
    return {
        frontmatter: { name, description },
        body: 'body',
        executableBlocks: [],
        filePath: `/skills/${name}.skill.md`,
    };
}

describe('SkillRegistry', () => {
    it('registers and retrieves a skill by name', () => {
        const reg = new SkillRegistry();
        const skill = makeSkill('greet');
        reg.register(skill);
        expect(reg.get('greet')).toBe(skill);
    });

    it('returns undefined for unregistered name', () => {
        const reg = new SkillRegistry();
        expect(reg.get('nonexistent')).toBeUndefined();
    });

    it('lists all registered skills', () => {
        const reg = new SkillRegistry();
        reg.register(makeSkill('a'));
        reg.register(makeSkill('b'));
        reg.register(makeSkill('c'));
        const list = reg.list();
        expect(list).toHaveLength(3);
        expect(list.map(s => s.frontmatter.name).sort()).toEqual(['a', 'b', 'c']);
    });

    it('returns correct size', () => {
        const reg = new SkillRegistry();
        expect(reg.size).toBe(0);
        reg.register(makeSkill('x'));
        expect(reg.size).toBe(1);
        reg.register(makeSkill('y'));
        expect(reg.size).toBe(2);
    });

    it('overwrites a skill with the same name', () => {
        const reg = new SkillRegistry();
        const v1 = makeSkill('skill');
        const v2 = makeSkill('skill');
        v2.body = 'updated';
        reg.register(v1);
        reg.register(v2);
        expect(reg.size).toBe(1);
        expect(reg.get('skill')!.body).toBe('updated');
    });

    it('list returns empty array when no skills registered', () => {
        const reg = new SkillRegistry();
        expect(reg.list()).toEqual([]);
    });
});
