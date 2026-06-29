/**
 * run-skill.ts — Tool that exposes the skill system to the agent runtime.
 *
 * The agent can call `run_skill` to execute any Markdown-defined skill
 * registered in the user's skills directory.
 *
 * The tool also surfaces a companion `list_skills` tool so the agent can
 * discover available skills without needing to know their names in advance.
 */

import { executeSkill } from '../../skills/skill-executor.js';
import type { Tool, ToolContext } from '../_base.js';

// ── run_skill ─────────────────────────────────────────────────────────────────

export const runSkillTool: Tool = {
    meta: { category: 'ai', version: '1.0.0', permission: 'dangerous' },
    declaration: {
        name: 'run_skill',
        description:
            '执行一个由 Markdown 技能文件定义的技能（skill.md）。' +
            '技能名称可通过 list_skills 查询。' +
            '调用时传入技能名称和所需参数。',
        parameters: {
            type: 'object',
            properties: {
                skill_name: {
                    type: 'string',
                    description: '要执行的技能名称，例如 "summarize_text"',
                },
                args: {
                    type: 'string',
                    description:
                        '传给技能的参数，格式为 JSON 对象字符串，例如 {"text": "...", "max_words": 150}',
                },
            },
            required: ['skill_name'],
        },
    },
    handler: async (rawArgs: Record<string, unknown>, _workDir: string, context?: ToolContext) => {
        const skillName = String(rawArgs['skill_name'] ?? '').trim();
        if (!skillName) return '[run_skill] Missing skill_name parameter';

        const registry = context?.skillRegistry;
        if (!registry) return '[run_skill] Skill registry not available in this context';

        const skill = registry.get(skillName);
        if (!skill) {
            const available = registry.list().map(s => s.frontmatter.name).join(', ');
            return `[run_skill] Unknown skill: "${skillName}". Available: ${available || '(none)'}`;
        }

        if (!context) return '[run_skill] Missing tool context';

        // Parse args: accept either a JSON string or a raw object when the model deep-parses it.
        let args: Record<string, unknown> = {};
        const rawArgsValue = rawArgs['args'];
        if (rawArgsValue) {
            if (typeof rawArgsValue === 'string') {
                try {
                    args = JSON.parse(rawArgsValue);
                } catch {
                    return `[run_skill] Invalid args JSON: ${rawArgsValue}`;
                }
            } else if (typeof rawArgsValue === 'object' && !Array.isArray(rawArgsValue)) {
                args = rawArgsValue as Record<string, unknown>;
            }
        }

        return executeSkill(skill, args, context);
    },
};

// ── list_skills ───────────────────────────────────────────────────────────────

export const listSkillsTool: Tool = {
    meta: { category: 'ai', version: '1.0.0', permission: 'read' },
    declaration: {
        name: 'list_skills',
        description:
            '列出当前用户可用的所有 Markdown 技能（skill.md），包含每个技能的名称、描述和参数说明。',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    handler: async (_args: Record<string, unknown>, _workDir: string, context?: ToolContext) => {
        const registry = context?.skillRegistry;
        if (!registry) return '[list_skills] Skill registry not available in this context';

        const skills = registry.list();
        if (skills.length === 0) return '当前没有已注册的技能。';

        const lines = skills.map(s => {
            const params = s.frontmatter.parameters?.properties
                ? Object.entries(s.frontmatter.parameters.properties)
                    .map(([k, v]) => `  - ${k} (${v.type}): ${v.description}`)
                    .join('\n')
                : '  (无参数)';
            const required = s.frontmatter.parameters?.required?.join(', ') ?? '无';
            return `### ${s.frontmatter.name}\n${s.frontmatter.description}\n参数：\n${params}\n必填：${required}`;
        });

        return lines.join('\n\n');
    },
};
