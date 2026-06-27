/**
 * Tests for openclaw-skills loader and prompt formatter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    loadOpenClawSkills,
    formatSkillsPrompt,
} from '../openclaw-skills.js';

let tmp: string;

beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'oc-skills-'));
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('loadOpenClawSkills', () => {
    it('returns [] when the directory does not exist', async () => {
        const out = await loadOpenClawSkills(join(tmp, 'no-such-dir'));
        expect(out).toEqual([]);
    });

    it('skips dirs without SKILL.md', async () => {
        await fs.mkdir(join(tmp, 'broken'));
        const out = await loadOpenClawSkills(tmp);
        expect(out).toEqual([]);
    });

    it('parses frontmatter and trims body', async () => {
        const skillDir = join(tmp, 'web-search');
        await fs.mkdir(skillDir);
        const md = `---
name: "web-search"
version: '1.2.3'
description: Search the web
description_zh: 网络搜索
---

# How to use

Run the tool.
`;
        await fs.writeFile(join(skillDir, 'SKILL.md'), md, 'utf8');
        const out = await loadOpenClawSkills(tmp);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            name: 'web-search',
            version: '1.2.3',
            description: 'Search the web',
            description_zh: '网络搜索',
        });
        expect(out[0].instructions).toContain('How to use');
    });

    it('falls back to dir name and "unknown" when frontmatter is missing', async () => {
        const skillDir = join(tmp, 'plain');
        await fs.mkdir(skillDir);
        await fs.writeFile(join(skillDir, 'SKILL.md'), 'no frontmatter here\n', 'utf8');
        const out = await loadOpenClawSkills(tmp);
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe('plain');
        expect(out[0].version).toBe('unknown');
        expect(out[0].description).toBe('');
    });
});

describe('formatSkillsPrompt', () => {
    it('returns empty string for empty skills array', () => {
        expect(formatSkillsPrompt([])).toBe('');
    });

    it('formats a list of skills into a prompt block', () => {
        const out = formatSkillsPrompt([
            {
                name: 's1', version: '1.0', description: 'd', instructions: 'do things',
                dirPath: '/x',
            },
            {
                name: 's2', version: '2.0', description: 'd2', description_zh: '中文', instructions: '做事情',
                dirPath: '/y',
            },
        ]);
        expect(out).toContain('# OpenClaw Skills');
        expect(out).toContain('## Skill: s1 (v1.0)');
        expect(out).toContain('do things');
        expect(out).toContain('## Skill: s2 (v2.0)');
        // Chinese description preferred when available
        expect(out).toContain('> 中文');
    });
});
