/**
 * update-now.ts — Maintain `memory/NOW.md`, the short-term focus snapshot.
 *
 * NOW.md is read on every turn and injected as "[User Background & Long-term
 * Goals]". It represents the user's current stage/mission/priorities — NOT a
 * task list. This tool exists so the agent has a first-class way to update
 * it (previously the docs referenced `update_now` but the tool didn't exist,
 * forcing agents to fall back to save_memory and causing hallucinated calls).
 *
 * Design:
 * - `read` / `write` / `patch` (append to end, before any trailing *Updated:* line)
 * - Enforces a byte cap (NOW.md is injected every turn)
 * - Auto-stamps an `*Updated: YYYY/MM/DD*` footer on writes
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../_base.js';

const NOW_MAX_BYTES = 4 * 1024; // 4 KB — keep it a focus snapshot, not a journal

function nowStamp(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
}

/** Strip any existing trailing "*Updated: ...*" footer so we can re-append. */
function stripTrailingStamp(text: string): string {
    return text.replace(/\n*---\n*\*Updated:[^\n]*\*\s*$/u, '').trimEnd();
}

function withStamp(body: string): string {
    const cleaned = stripTrailingStamp(body.trim());
    return `${cleaned}\n\n---\n*Updated: ${nowStamp()}*\n`;
}

export const updateNowTool: Tool = {
    meta: { category: 'utility', version: '1.0.0', permission: 'write' },
    declaration: {
        name: 'update_now',
        description:
            '更新 memory/NOW.md — 用户当前阶段的近况/长期目标快照（每轮对话会自动注入 system prompt）。\n' +
            '⚠️ 仅在用户明确说"记住/更新状态/记录这个阶段"或出现明显里程碑时使用。\n' +
            '• action=read  — 读取当前 NOW.md\n' +
            '• action=write — 完整覆写（传完整 markdown 内容）\n' +
            '• action=patch — 在末尾追加内容（自动放在 *Updated* footer 之前）',
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
                    description: '[write/patch] 要写入/追加的内容（Markdown）',
                },
            },
            required: ['action'],
        },
    },

    handler: async (args, workDir) => {
        const nowPath = join(workDir, '.neo', 'memory', 'NOW.md');
        const action = String(args.action ?? '').trim();

        if (action === 'read') {
            try {
                const content = await fs.readFile(nowPath, 'utf8');
                return `🗒️ .neo/memory/NOW.md:\n\n${content}`;
            } catch {
                return '（NOW.md 尚未创建）';
            }
        }

        if (action !== 'write' && action !== 'patch') {
            return `[Error] 未知 action: "${action}"`;
        }

        const content = String(args.content ?? '').trim();
        if (!content) return `[Error] ${action} 需要提供 content`;

        await fs.mkdir(join(workDir, '.neo', 'memory'), { recursive: true });

        let next: string;
        if (action === 'write') {
            next = withStamp(content);
        } else {
            let existing = '';
            try { existing = await fs.readFile(nowPath, 'utf8'); } catch { /* new file */ }
            const body = stripTrailingStamp(existing);
            const sep = body && !body.endsWith('\n') ? '\n\n' : body ? '\n' : '';
            next = withStamp(`${body}${sep}${content}`);
        }

        if (Buffer.byteLength(next, 'utf8') > NOW_MAX_BYTES) {
            return `[Error] NOW.md 超过 ${NOW_MAX_BYTES} 字节上限。NOW.md 是近况快照，过长的内容请放到 save_memory 的 memory/facts.md 或 memory/daily/。`;
        }

        await fs.writeFile(nowPath, next, 'utf8');
        const verb = action === 'write' ? '已覆写' : '已追加到';
        return `✅ ${verb} memory/NOW.md（${content.length} 字符，总大小 ${Buffer.byteLength(next, 'utf8')} B）`;
    },
};
