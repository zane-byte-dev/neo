/**
 * update-now.ts — Update the short-term memory (workbench) file.
 */
import { join } from 'path';
import { promises as fs } from 'fs';
import type { Tool } from './_base.js';
import { getVaultRoot } from '../utils/helpers.js';

export const updateNowTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'update_now',
        description:
            '更新短期记忆文件 (NOW.md)。该文件定义了当前的核心任务、今日焦点和优先级。' +
            '当核心目标发生变化、任务完成或进入新阶段时，应立即调用此工具。',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '完整的 NOW.md Markdown 内容。建议包含 Mission, Today, Priorities 等区块。',
                },
            },
            required: ['content'],
        },
    },
    handler: async (args, _workDir) => {
        const { content } = args as { content: string };
        const vaultRoot = getVaultRoot();
        const outPath = join(vaultRoot, 'NOW.md');

        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        let finalContent = content;
        
        // Ensure timestamp is present if not already there
        if (!content.includes('*Updated:')) {
            finalContent += `\n\n---\n*Updated: ${timestamp}*`;
        }

        try {
            await fs.mkdir(vaultRoot, { recursive: true });
            await fs.writeFile(outPath, finalContent, 'utf-8');
            return `✅ NOW.md 已更新。内容长度: ${finalContent.length} 字符。`;
        } catch (err: any) {
            return `❌ 更新 NOW.md 失败: ${err.message}`;
        }
    },
};
