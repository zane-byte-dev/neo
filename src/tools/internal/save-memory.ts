/**
 * save-memory.ts — Persist facts and notes to the user's memory directory.
 *
 * Writes to {workDir}/memory/ — a persistent, cross-session knowledge store.
 * Unlike update_now (which is NOW.md specific), this tool can create/update
 * any memory file, enabling the agent to build up long-term knowledge.
 *
 * Memory directory structure:
 *   memory/
 *     NOW.md         — short-term focus (managed by update_now)
 *     facts.md       — accumulated facts and preferences
 *     daily/         — daily logs
 *     {custom}.md    — any other memory files
 */
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import type { Tool } from '../_base.js';

export const saveMemoryTool: Tool = {
    meta: { category: 'utility', version: '1.0.0', permission: 'write' },
    declaration: {
        name: 'save_memory',
        description:
            '将信息持久化到用户的记忆目录（memory/）。跨会话可用。\n' +
            '• action=append — 追加内容到指定文件末尾（默认）\n' +
            '• action=write  — 覆写整个文件\n' +
            '• action=read   — 读取记忆文件内容\n' +
            '• action=list   — 列出记忆目录下的文件\n\n' +
            '适合保存：用户偏好、项目约定、学到的经验、任务总结等长期信息。',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['append', 'write', 'read', 'list'],
                    description: '操作类型（默认 append）',
                },
                file: {
                    type: 'string',
                    description:
                        '[append/write/read] 文件路径，相对于 memory/ 目录。例如: "facts.md"、"daily/2026-04-13.md"',
                },
                content: {
                    type: 'string',
                    description: '[append/write] 要写入的内容',
                },
            },
            required: ['action'],
        },
    },

    handler: async (args, workDir) => {
        const memDir = join(workDir, 'memory');
        const action = String(args.action ?? 'append').trim();

        // ── LIST
        if (action === 'list') {
            return await listMemory(memDir);
        }

        // ── READ
        if (action === 'read') {
            const file = String(args.file ?? '').trim();
            if (!file) return '[Error] read 需要指定 file';
            const filePath = safePath(memDir, file);
            if (!filePath) return '[Error] 路径不合法';
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                return `📖 memory/${file}:\n\n${content}`;
            } catch {
                return `[Error] 文件不存在: memory/${file}`;
            }
        }

        // ── APPEND / WRITE
        const file = String(args.file ?? '').trim();
        const content = String(args.content ?? '').trim();
        if (!file) return '[Error] 需要指定 file';
        if (!content) return '[Error] 需要提供 content';
        const filePath = safePath(memDir, file);
        if (!filePath) return '[Error] 路径不合法';

        await fs.mkdir(dirname(filePath), { recursive: true });

        if (action === 'write') {
            await fs.writeFile(filePath, content, 'utf-8');
            return `✅ 已写入 memory/${file}（${content.length} 字符）`;
        }

        // append
        let existing = '';
        try {
            existing = await fs.readFile(filePath, 'utf-8');
        } catch { /* file doesn't exist yet */ }
        const separator = existing && !existing.endsWith('\n') ? '\n' : '';
        await fs.writeFile(filePath, existing + separator + content + '\n', 'utf-8');
        return `✅ 已追加到 memory/${file}（+${content.length} 字符）`;
    },
};

/** Ensure path stays within memDir (prevent path traversal). */
function safePath(memDir: string, relative: string): string | null {
    const full = resolve(memDir, relative);
    if (!full.startsWith(resolve(memDir) + '/') && full !== resolve(memDir)) {
        return null;
    }
    return full;
}

/** Recursively list files in memory directory. */
async function listMemory(memDir: string, rel = ''): Promise<string> {
    try {
        const entries = await fs.readdir(join(memDir, rel), { withFileTypes: true });
        const lines: string[] = [];
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith('.')) continue;
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                lines.push(`📁 ${relPath}/`);
                const sub = await listMemory(memDir, relPath);
                if (sub) lines.push(sub);
            } else {
                const stat = await fs.stat(join(memDir, relPath));
                const size = stat.size < 1024
                    ? `${stat.size}B`
                    : `${(stat.size / 1024).toFixed(1)}KB`;
                lines.push(`  📄 ${relPath} (${size})`);
            }
        }
        return lines.join('\n');
    } catch {
        return rel ? '' : '（memory/ 目录为空或不存在）';
    }
}
