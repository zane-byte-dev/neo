import { invalidateUserCache } from '../../services/user-service.js';
import {
    deleteSkillByName,
    getSkillRecord,
    saveSkillFromRawContent,
    scanAllSkills,
    setSkillEnabled,
} from '../../skills/skill-store.js';
import type { Tool } from '../_base.js';

function requireName(args: Record<string, unknown>): string {
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('name is required');
    return name;
}

function syncCurrentRegistry(
    context: Parameters<Tool['handler']>[2],
    input: { name: string; enabled: boolean; skill?: { frontmatter: { name: string } } },
): void {
    const registry = context?.skillRegistry;
    if (!registry) return;

    if (!input.enabled) {
        registry.unregister(input.name);
        return;
    }

    if (input.skill) {
        registry.register(input.skill as never);
    }
}

export const manageSkillTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0', permission: 'write' },
    declaration: {
        name: 'manage_skill',
        description:
            '管理当前用户的 skill。' +
            '当用户要求把当前对话、提示词套路、固定产出格式或一段可复用工作流沉淀成下次可直接调用的 skill 时，用它保存。' +
            '保存成功后，当前上下文会立即更新，后续可直接调用 run_skill 或 list_skills。',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'get', 'save', 'delete', 'set_enabled'],
                    description: '操作类型：列出、读取、保存/更新、删除、启用/禁用 skill',
                },
                name: {
                    type: 'string',
                    description: 'skill 名称。get/delete/set_enabled 必填；save 可省略并从 raw_content frontmatter 读取。',
                },
                raw_content: {
                    type: 'string',
                    description:
                        '完整的 .skill.md 内容，包含 YAML frontmatter 和正文。save 时必填。' +
                        '如果用户希望把当前对话沉淀成 skill，应先根据对话整理出完整 skill 内容，再传给本字段。',
                },
                enabled: {
                    type: 'boolean',
                    description: 'set_enabled 时要设置的启用状态',
                },
            },
            required: ['action'],
        },
    },
    handler: async (args, workDir, context) => {
        const stateDir = context?.stateDir ?? workDir;
        const action = String(args.action ?? '').trim();

        try {
            switch (action) {
                case 'list': {
                    const skills = await scanAllSkills(stateDir);
                    if (skills.length === 0) return '当前没有任何已保存的 skill。';
                    return skills
                        .map((skill) => {
                            const enabled = skill.frontmatter.enabled !== false ? 'enabled' : 'disabled';
                            const tags = skill.frontmatter.tags?.length ? ` [${skill.frontmatter.tags.join(', ')}]` : '';
                            return `- ${skill.frontmatter.name} (${enabled})${tags}: ${skill.frontmatter.description}`;
                        })
                        .join('\n');
                }

                case 'get': {
                    const name = requireName(args);
                    const record = await getSkillRecord(stateDir, name);
                    if (!record) return `[manage_skill] Skill "${name}" not found.`;
                    return `# ${record.skill.frontmatter.name}\n\n${record.rawContent}`;
                }

                case 'save': {
                    const rawContent = String(args.raw_content ?? '');
                    const expectedName = String(args.name ?? '').trim() || undefined;
                    const record = await saveSkillFromRawContent(stateDir, rawContent, expectedName);
                    syncCurrentRegistry(context, {
                        name: record.skill.frontmatter.name,
                        enabled: record.skill.frontmatter.enabled !== false,
                        skill: record.skill,
                    });
                    if (context?.userId) invalidateUserCache(context.userId);
                    return `✅ 已保存 skill "${record.skill.frontmatter.name}"。现在可直接用 run_skill 或 list_skills 复用它。`;
                }

                case 'delete': {
                    const name = requireName(args);
                    const deleted = await deleteSkillByName(stateDir, name);
                    if (!deleted) return `[manage_skill] Skill "${name}" not found.`;
                    syncCurrentRegistry(context, { name, enabled: false });
                    if (context?.userId) invalidateUserCache(context.userId);
                    return `✅ 已删除 skill "${name}"。`;
                }

                case 'set_enabled': {
                    const name = requireName(args);
                    if (typeof args.enabled !== 'boolean') {
                        return '[manage_skill] `enabled` (boolean) is required for set_enabled.';
                    }

                    const record = await setSkillEnabled(stateDir, name, args.enabled);
                    syncCurrentRegistry(context, {
                        name,
                        enabled: record.skill.frontmatter.enabled !== false,
                        skill: record.skill,
                    });
                    if (context?.userId) invalidateUserCache(context.userId);
                    return `✅ Skill "${name}" 已${args.enabled ? '启用' : '禁用'}。`;
                }

                default:
                    return `[manage_skill] Unsupported action: ${action || '(empty)'}`;
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return `[manage_skill] ${message}`;
        }
    },
};