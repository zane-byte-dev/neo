/**
 * update-user-profile.ts — Let the agent update the user's profile (USER.md).
 *
 * USER.md is baked into the tenant `systemInstruction` cache, so every write
 * MUST invalidate the cache, otherwise the running process keeps seeing the
 * stale copy until restart.
 *
 * Because USER.md ends up inside the system prompt, we also enforce a
 * whitelist-ish sanitization pass to mitigate prompt-injection via profile
 * edits (attacker-controlled instructions masquerading as "profile facts").
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Tool, ToolContext } from '../_base.js';
import { invalidateUserCache } from '../../services/user-service.js';

/** Hard cap on USER.md size — it's injected every turn, don't let it balloon. */
const MAX_USER_MD_BYTES = 8 * 1024; // 8 KB

/**
 * Strip / neutralize content that looks like a prompt-injection attempt.
 * Returns `{ clean, warnings }` — if `warnings` is non-empty, callers
 * should surface them to the user.
 */
export function sanitizeProfileContent(raw: string): { clean: string; warnings: string[] } {
    const warnings: string[] = [];
    let clean = raw.replace(/\r\n/g, '\n').trim();

    // Block fake section markers that masquerade as our prompt tags.
    // Note: \b does not work at CJK boundaries; use a permissive end match.
    const suspiciousHeaders = [
        /^\s*\[(?:系统|system|runtime\s*context|new\s*message|用户档案|previous\s*conversation)[^\]]*\]\s*/gim,
        /^\s*#{1,3}\s*(system|ignore|override)\b/gim,
    ];
    for (const re of suspiciousHeaders) {
        if (re.test(clean)) {
            warnings.push('检测到可疑的系统指令风格标记，已转义。');
            clean = clean.replace(re, (m) => `<!-- sanitized: ${m.trim()} -->`);
        }
    }

    // Common jailbreak phrases — flag but don't hard-block (could be legit quote).
    const injectionPatterns = [
        /ignore (all )?(previous|prior) (instructions|context)/i,
        /(you are now|from now on you'?re) .{0,80}(developer|dan|unrestricted)/i,
        /disregard .{0,40}system prompt/i,
    ];
    for (const re of injectionPatterns) {
        if (re.test(clean)) {
            warnings.push(`检测到疑似越狱语句: ${re}`);
        }
    }

    return { clean, warnings };
}

function formatWarnings(warnings: string[]): string {
    if (!warnings.length) return '';
    return `\n\n⚠️ 安全提示:\n${warnings.map((w) => `  - ${w}`).join('\n')}`;
}

export const updateUserProfileTool: Tool = {
    meta: { category: 'utility', version: '1.1.0', permission: 'write' },
    declaration: {
        name: 'update_user_profile',
        description:
            '更新用户档案文件 USER.md（长期身份/偏好/背景）。该文件会被注入 system prompt。\n' +
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

    handler: async (args, workDir, context?: ToolContext) => {
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

        if (action !== 'write' && action !== 'patch') {
            return `[Error] 未知 action: "${action}"`;
        }

        const raw = String(args.content ?? '').trim();
        if (!raw) return `[Error] ${action} 需要提供 content`;

        const { clean, warnings } = sanitizeProfileContent(raw);

        let nextContent: string;
        if (action === 'write') {
            nextContent = clean;
        } else {
            let existing = '';
            try { existing = await fs.readFile(filePath, 'utf8'); } catch { /* new file */ }
            const sep = existing && !existing.endsWith('\n') ? '\n' : '';
            nextContent = existing + sep + clean + '\n';
        }

        if (Buffer.byteLength(nextContent, 'utf8') > MAX_USER_MD_BYTES) {
            return `[Error] USER.md 超过 ${MAX_USER_MD_BYTES} 字节上限。请精简或改用 save_memory 把细节挪到 memory/。`;
        }

        await fs.writeFile(filePath, nextContent, 'utf8');

        // USER.md is baked into systemInstruction cache — MUST invalidate.
        if (context?.userId) {
            invalidateUserCache(context.userId);
        } else {
            invalidateUserCache();
        }

        const label = action === 'write' ? '已更新' : '已追加到';
        return `✅ ${label}用户档案（${clean.length} 字符）${formatWarnings(warnings)}`;
    },
};
