import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillRegistry } from '../../../skills/skill-registry.js';
import { manageSkillTool } from '../manage-skill.js';
import { listSkillsTool } from '../run-skill.js';

let stateDir: string;
let registry: SkillRegistry;
let ctx: {
    userId: string;
    sessionId: string;
    workDir: string;
    stateDir: string;
    systemInstruction: string;
    skillRegistry: SkillRegistry;
};

const SKILL_CONTENT = `---
name: brief_reply
description: Draft a concise reply based on the current context.
tags:
  - writing
---
先整理用户目标，再给出一个简洁可发送的回复草稿。
`;

beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'neo-manage-skill-'));
    registry = new SkillRegistry();
    ctx = {
        userId: 'u1',
        sessionId: 's1',
        workDir: '/tmp',
        stateDir,
        systemInstruction: '',
        skillRegistry: registry,
    };
});

afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
});

describe('manage_skill tool', () => {
    it('saves a skill and makes it immediately visible to list_skills', async () => {
        const out = await manageSkillTool.handler(
            { action: 'save', raw_content: SKILL_CONTENT },
            '/tmp',
            ctx,
        );

        expect(out).toContain('已保存 skill "brief_reply"');
        expect(readFileSync(join(stateDir, 'skills', 'brief_reply.skill.md'), 'utf8')).toContain('brief_reply');

        const listed = await listSkillsTool.handler({}, '/tmp', ctx);
        expect(listed).toContain('brief_reply');
        expect(listed).toContain('Draft a concise reply');
    });

    it('disables a skill and removes it from the current registry immediately', async () => {
        await manageSkillTool.handler({ action: 'save', raw_content: SKILL_CONTENT }, '/tmp', ctx);

        const out = await manageSkillTool.handler(
            { action: 'set_enabled', name: 'brief_reply', enabled: false },
            '/tmp',
            ctx,
        );

        expect(out).toContain('已禁用');
        expect(registry.get('brief_reply')).toBeUndefined();
        expect(await listSkillsTool.handler({}, '/tmp', ctx)).toContain('没有已注册的技能');
    });
});