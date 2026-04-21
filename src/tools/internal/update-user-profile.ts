/**
 * update-user-profile.ts — Let the agent update the user's profile (USER.md).
 *
 * Enables the agent to accumulate long-term knowledge about the user:
 * preferences, habits, background, etc.  Similar to update_now but for
 * the user identity file.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../_base.js';

export const updateUserProfileTool: Tool = {
    meta: { category: 'utility', version: '1.0.0', permission: 'write' },
    declaration: {
        name: 'update_user_profile',
        description:
            '更新用户档案文件 USER.md。可用于记录用户的偏好、习惯、工作背景等长期信息。\n' +
            '⚠️ 仅在用户明确提供个人信息或要求更新时使用，不要主动推测。\n' +
            '• action=read  — 读取当前档案内容\n' +
            '• action=write — 覆写整个档案（需要传完整内容）\n' +
            '• action=patch — 追加信息到档案末尾',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['read', 'write', 'patch'],
                    description: '操作类型',
                },
                content: {
                    type: 'string',
                    description: '[write/patch] 要写入的内容',
                },
            },
            required: ['action'],
        },
    },

    handler: async (args, workDir) => {
        const filePath = join(workDir, 'USER.md');
        const action = String(args.action ?? '').trim();

        if (action === 'read') {
            try {
                const content = await fs.readFile(filePath, 'utf8');
                return `📋 当前用户档案:\n\n${content}`;
            } catch {
                return '（用户档案尚未创建）';
            }
        }

        if (action === 'write') {
            const content = String(args.content ?? '').trim();
            if (!content) return '[Error] write 需要提供 content';
            await fs.writeFile(filePath, content, 'utf8');
            return `✅ 用户档案已更新（${content.length} 字符）`;
        }

        if (action === 'patch') {
            const content = String(args.content ?? '').trim();
            if (!content) return '[Error] patch 需要提供 content';
            let existing = '';
            try {
                existing = await fs.readFile(filePath, 'utf8');
            } catch { /* file doesn't exist yet */ }
            const separator = existing && !existing.endsWith('\n') ? '\n' : '';
            await fs.writeFile(filePath, existing + separator + content + '\n', 'utf8');
            return `✅ 已追加到用户档案（+${content.length} 字符）`;
        }

        return `[Error] 未知 action: "${action}"`;
    },
};
