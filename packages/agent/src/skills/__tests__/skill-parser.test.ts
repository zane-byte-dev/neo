import { describe, it, expect } from 'vitest';
import { parseSkillFile } from '../skill-parser.js';

const BASIC_SKILL = `---
name: test_skill
description: A test skill
---

This is the body of the skill.`;

const FULL_SKILL = `---
name: full_skill
description: A full skill with all fields
version: "1.0"
tags:
  - test
  - demo
parameters:
  type: object
  properties:
    query:
      type: string
      description: Search query
  required:
    - query
---

Use {{query}} to search.

\`\`\`js execute
console.log("hello {{query}}");
\`\`\``;

describe('parseSkillFile', () => {
    it('parses a basic .skill.md with frontmatter and body', () => {
        const result = parseSkillFile(BASIC_SKILL, '/test/basic.skill.md');
        expect(result.frontmatter.name).toBe('test_skill');
        expect(result.frontmatter.description).toBe('A test skill');
        expect(result.body).toBe('This is the body of the skill.');
        expect(result.filePath).toBe('/test/basic.skill.md');
        expect(result.executableBlocks).toEqual([]);
    });

    it('parses parameters from frontmatter', () => {
        const result = parseSkillFile(FULL_SKILL, '/test/full.skill.md');
        expect(result.frontmatter.parameters).toBeDefined();
        expect(result.frontmatter.parameters!.type).toBe('object');
        expect(result.frontmatter.parameters!.properties).toHaveProperty('query');
        expect(result.frontmatter.parameters!.required).toEqual(['query']);
    });

    it('extracts executable code blocks', () => {
        const result = parseSkillFile(FULL_SKILL, '/test/full.skill.md');
        expect(result.executableBlocks).toHaveLength(1);
        expect(result.executableBlocks[0].lang).toBe('js');
        expect(result.executableBlocks[0].code).toBe('console.log("hello {{query}}");');
    });

    it('extracts multiple executable blocks', () => {
        const content = `---
name: multi
description: Multi-block skill
---

Some text.

\`\`\`js execute
console.log("block1");
\`\`\`

More text.

\`\`\`python execute
print("block2")
\`\`\``;
        const result = parseSkillFile(content, '/test/multi.skill.md');
        expect(result.executableBlocks).toHaveLength(2);
        expect(result.executableBlocks[0].lang).toBe('js');
        expect(result.executableBlocks[1].lang).toBe('python');
    });

    it('ignores non-execute code blocks', () => {
        const content = `---
name: noexec
description: No exec blocks
---

\`\`\`js
console.log("not executable");
\`\`\``;
        const result = parseSkillFile(content, '/test/noexec.skill.md');
        expect(result.executableBlocks).toEqual([]);
    });

    it('throws when frontmatter is missing', () => {
        expect(() => parseSkillFile('No frontmatter here', '/test/bad.skill.md'))
            .toThrow('No frontmatter found');
    });

    it('throws when name is missing', () => {
        const content = `---
description: Missing name
---
body`;
        expect(() => parseSkillFile(content, '/test/noname.skill.md'))
            .toThrow('missing required field: name');
    });

    it('throws when description is missing', () => {
        const content = `---
name: nodesc
---
body`;
        expect(() => parseSkillFile(content, '/test/nodesc.skill.md'))
            .toThrow('missing required field: description');
    });

    it('parses enabled: false correctly', () => {
        const content = `---
name: disabled_skill
description: This skill is disabled
enabled: false
---
body`;
        const result = parseSkillFile(content, '/test/disabled.skill.md');
        expect(result.frontmatter.enabled).toBe(false);
    });

    it('parses tags array correctly', () => {
        const result = parseSkillFile(FULL_SKILL, '/test/full.skill.md');
        expect(result.frontmatter.tags).toEqual(['test', 'demo']);
    });

    it('parses version string correctly', () => {
        const result = parseSkillFile(FULL_SKILL, '/test/full.skill.md');
        expect(result.frontmatter.version).toBe('1.0');
    });

    it('leaves enabled undefined when not specified', () => {
        const result = parseSkillFile(BASIC_SKILL, '/test/basic.skill.md');
        expect(result.frontmatter.enabled).toBeUndefined();
    });
});
