import { join, resolve } from 'path';
import { promises as fs } from 'fs';
import { SKIP_DIRS } from '../config.js';
import { getConfiguredWorkDir } from '../utils/helpers.js';
import type { Command } from './_base.js';
import { getDb } from '../services/db.js';
import { getActiveTenantKey } from '../services/tool-context.js';

export const workspaceCommand: Command = {
    commands: ['/ls', '/read', '/note', '/today', '/task', '/search', '/weekly', '/save'],
    handler: async (command, text, msg, deps) => {
    const reply = (t: string, md = false) => deps.adapter.sendMessage(msg.chatId, t, md ? { parseMode: 'markdown' } : undefined);
    switch (command) {
        case '/ls': {
            const workDir = getConfiguredWorkDir();
            if (!workDir) {
                await reply('⚠️ WORK_DIR 未配置。');
                return true;
            }
            const rawArg = text.split(' ').slice(1).join(' ').trim();
            const safeSuffix = rawArg.replace(/^[./\\]+/, '');
            const targetDir = safeSuffix ? join(workDir, safeSuffix) : workDir;
            const resolvedTarget = resolve(targetDir);
            const resolvedBase = workDir;
            if (!resolvedTarget.startsWith(resolvedBase)) {
                await reply('⛔ 不允许访问 WORK_DIR 以外的路径。');
                return true;
            }
            try {
                const entries = await fs.readdir(resolvedTarget, { withFileTypes: true });
                if (entries.length === 0) {
                    await reply(`📂 ${safeSuffix || '/'} 目录为空。`);
                    return true;
                }
                const lines = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
                const displayPath = safeSuffix || '(workspace root)';
                await reply(`📂 ${displayPath}\n\n` + lines.join('\n'));
            } catch (err: any) {
                await reply(`❌ 无法读取目录: ${err.message}`);
            }
            return true;
        }

        case '/read': {
            const workDir = getConfiguredWorkDir();
            if (!workDir) {
                await reply('⚠️ WORK_DIR 未配置。');
                return true;
            }
            const rawArg = text.split(' ').slice(1).join(' ').trim();
            if (!rawArg) {
                await reply('用法: /read <路径或关键词>\n例: /read 随手记  /read inbox/note.md');
                return true;
            }
            const resolvedBase = workDir;

            const sendFile = async (absPath: string, label: string) => {
                const stat = await fs.stat(absPath);
                if (stat.size > 100 * 1024) {
                    await reply(`⚠️ 文件超过 100KB（${(stat.size / 1024).toFixed(1)}KB），请缩小范围。`);
                    return;
                }
                const content = await fs.readFile(absPath, 'utf8');
                const MAX_MSG = 4000;
                const header = `📄 ${label}\n\n`;
                if (header.length + content.length <= MAX_MSG) {
                    await reply(header + content);
                } else {
                    const chunks: string[] = [];
                    for (let i = 0; i < content.length; i += MAX_MSG - header.length) {
                        chunks.push(content.slice(i, i + MAX_MSG - header.length));
                    }
                    await reply(`📄 ${label} (${chunks.length} 段)\n\n${chunks[0]}`);
                    for (let i = 1; i < chunks.length; i++) {
                        await reply(chunks[i]).catch(() => {});
                    }
                }
            };

            const safeSuffix = rawArg.replace(/^[./\\]+/, '');
            const exactPath = resolve(join(workDir, safeSuffix));
            if (exactPath.startsWith(resolvedBase)) {
                try {
                    const stat = await fs.stat(exactPath);
                    if (stat.isDirectory()) {
                        const entries = await fs.readdir(exactPath, { withFileTypes: true });
                        if (entries.length === 0) {
                            await reply(`📂 ${safeSuffix} 目录为空。`);
                        } else {
                            const lines = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
                            await reply(`📂 ${safeSuffix}\n\n` + lines.join('\n'));
                        }
                        return true;
                    }
                    await sendFile(exactPath, safeSuffix);
                    return true;
                } catch {
                    // fall through to fuzzy search
                }
            }

            const matches = await deps.findFiles(rawArg, workDir, resolvedBase);

            if (matches.length === 0) {
                await reply(`🔍 未找到匹配 "${rawArg}" 的文件。`);
            } else if (matches.length === 1) {
                const relPath = matches[0].slice(resolvedBase.length + 1);
                await sendFile(matches[0], relPath);
            } else {
                const MAX_SHOW = 10;
                const shown = matches.slice(0, MAX_SHOW);
                const lines = shown.map((p, i) => `${i + 1}. ${p.slice(resolvedBase.length + 1)}`);
                const suffix = matches.length > MAX_SHOW ? `\n\n...还有 ${matches.length - MAX_SHOW} 个，请缩窄关键词` : '';
                await reply(`🔍 找到 ${matches.length} 个匹配文件：\n\n${lines.join('\n')}${suffix}\n\n回复序号直接阅读，例如发送 "r1" 读取第1个，"r2" 读取第2个。`);
                deps.pendingReadMatches.set(msg.chatId, { matches: shown, expiry: Date.now() + 120_000 });
            }
            return true;
        }

        case '/note': {
            const noteContent = text.replace(/^\/note\s*/i, '').trim();
            if (!noteContent) {
                await reply('用法: `/note <内容>`\n\n快速追加一条碎片到今日 Inbox，不经过 AI。', true);
                return true;
            }
            try {
                const tenantKey = getActiveTenantKey()!;
                const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
                const timeStr = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
                getDb().prepare(
                    `INSERT INTO notes (tenant_key, content, date, time, created_at) VALUES (?, ?, ?, ?, ?)`
                ).run(tenantKey, noteContent, today, timeStr, Date.now());
                await reply(`✅ 已记入 Inbox（${today} ${timeStr}）`);
            } catch (err: any) {
                await reply(`❌ 写入失败: ${err.message}`);
            }
            return true;
        }

        case '/today': {
            const workDir = getConfiguredWorkDir();
            const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
            const tenantKey = getActiveTenantKey()!;

            // Inbox entries from SQLite
            const noteRows = getDb().prepare(
                `SELECT time, content FROM notes WHERE tenant_key = ? AND date = ? ORDER BY created_at ASC`
            ).all(tenantKey, today) as Array<{ time: string; content: string }>;

            // Daily log from memory/1-Daily/
            let daily: string | null = null;
            if (workDir) {
                try { daily = await fs.readFile(join(workDir, 'memory', '1-Daily', `${today}.md`), 'utf-8'); }
                catch { /* not yet */ }
            }

            if (noteRows.length === 0 && !daily) {
                await reply(`📭 今天（${today}）还没有任何记录。\n\n用 \`/note <内容>\` 开始记录。`, true);
                return true;
            }

            const MAX = 3500;
            if (noteRows.length > 0) {
                const inboxText = noteRows.map(r => `- ${r.time} ${r.content}`).join('\n');
                const header = `📥 **Inbox / ${today}**\n\n`;
                const body = inboxText.length > MAX ? inboxText.slice(0, MAX) + '\n...(已截断)' : inboxText;
                await reply(header + body, true).catch(() => reply(header + body));
            }
            if (daily) {
                const header = `📓 **memory/1-Daily/${today}.md**\n\n`;
                const body = daily.length > MAX ? daily.slice(0, MAX) + '\n...(已截断)' : daily;
                await reply(header + body, true).catch(() => reply(header + body));
            }
            return true;
        }

        case '/task': {
            const taskContent = text.replace(/^\/task\s*/i, '').trim();
            if (!taskContent) {
                await reply('用法: `/task <内容>`\n\n快速追加一条任务，不经过 AI。', true);
                return true;
            }
            try {
                const tenantKey = getActiveTenantKey()!;
                const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
                const timeStr = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
                const id = Math.random().toString(36).slice(2, 10);
                getDb().prepare(
                    `INSERT INTO tasks (id, tenant_key, content, status, date, time, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?)`
                ).run(id, tenantKey, taskContent, today, timeStr, Date.now());
                await reply('✅ 任务已记录');
            } catch (err: any) {
                await reply(`❌ 写入失败: ${err.message}`);
            }
            return true;
        }

        case '/search': {
            const workDir = getConfiguredWorkDir();
            if (!workDir) { await reply('⚠️ WORK_DIR 未配置。'); return true; }
            const query = text.replace(/^\/search\s*/i, '').trim();
            if (!query) {
                await reply('用法: `/search <关键词>`\n\n全文搜索 vault 中所有 .md 文件。', true);
                return true;
            }
            const absBase = workDir;
            const MAX_RESULTS = 8;
            const CONTEXT_CHARS = 120;
            interface SearchHit { file: string; line: number; snippet: string; }
            const hits: SearchHit[] = [];

            const walk = async (dir: string): Promise<void> => {
                if (hits.length >= MAX_RESULTS) return;
                let entries: import('fs').Dirent[];
                try { entries = await fs.readdir(dir, { withFileTypes: true }); }
                catch { return; }
                for (const e of entries) {
                    if (hits.length >= MAX_RESULTS) break;
                    const abs = join(dir, e.name);
                    if (e.isDirectory()) {
                        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
                        await walk(abs);
                    } else if (e.isFile() && e.name.endsWith('.md')) {
                        const content = await fs.readFile(abs, 'utf-8').catch(() => '');
                        const lines = content.split('\n');
                        const q = query.toLowerCase();
                        for (let i = 0; i < lines.length && hits.length < MAX_RESULTS; i++) {
                            if (lines[i].toLowerCase().includes(q)) {
                                const snippet = lines[i].trim().slice(0, CONTEXT_CHARS);
                                hits.push({ file: abs.slice(absBase.length + 1), line: i + 1, snippet });
                            }
                        }
                    }
                }
            };

            await walk(absBase);

            if (hits.length === 0) {
                await reply(`🔍 未找到包含 "${query}" 的内容。`);
            } else {
                const lines = hits.map(h => `📄 \`${h.file}\` L${h.line}\n   ${h.snippet}`);
                await reply(
                    `🔍 **"${query}"** 找到 ${hits.length} 处匹配：\n\n` + lines.join('\n\n'),
                    true
                ).catch(() =>
                    reply(`🔍 "${query}" 找到 ${hits.length} 处：\n\n` + hits.map(h => `${h.file}:${h.line}  ${h.snippet}`).join('\n\n'))
                );
            }
            return true;
        }

        case '/weekly': {
            const statusMsg = await reply('⏳ 正在生成本周周报...');
            try {
                const { generateWeeklyReportTool } = await import('../tools/generate-weekly-report.js');
                const text = await generateWeeklyReportTool.handler({}, '');
                await deps.adapter.editMessage(msg.chatId, statusMsg.id, text.slice(0, 4000)).catch(() =>
                    reply(text.slice(0, 4000)));
            } catch (err: any) {
                await deps.adapter.editMessage(msg.chatId, statusMsg.id, `❌ 周报生成失败: ${err.message}`).catch(() => {});
            }
            return true;
        }

        case '/save': {
            const workDir = getConfiguredWorkDir();
            if (!workDir) { await reply('⚠️ WORK_DIR 未配置。'); return true; }

            // Content comes from: replied-to message first, then text after command
            const replyText: string | undefined = msg.quotedText;
            const arg = text.replace(/^\/save\s*/i, '').trim();

            const rawContent = replyText ?? arg;
            if (!rawContent) {
                await reply(
                    '用法：回复任意消息，发送 `/save [标题]` 即可存入 `archives/`。\n\n' +
                    '示例：\n`/save` — 以时间戳命名\n`/save AI工具对比` — 自定义标题\n`/save Wiki/AI工具对比` — 存入指定子目录',
                    true
                );
                return true;
            }

            // Parse subdir and title from arg
            // e.g. "Wiki/AI工具" → subdir=Wiki, title=AI工具
            // e.g. "AI工具" → subdir=Wiki (default), title=AI工具
            // e.g. "" → subdir=Wiki, title=timestamp
            let subDir = 'Wiki';
            let title = '';

            if (arg.includes('/')) {
                const slashIdx = arg.indexOf('/');
                subDir = arg.slice(0, slashIdx).trim() || 'Wiki';
                title = arg.slice(slashIdx + 1).trim();
            } else {
                title = arg;
            }

            if (!title) {
                const now = new Date();
                const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
                const timeStr = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).replace(':', '');
                title = `saved-${dateStr}-${timeStr}`;
            }

            // Sanitize path components to prevent path traversal
            const safeSubDir = subDir.replace(/[\/\\..]/g, '').slice(0, 64);
            const safeTitle = title.replace(/[\/\\:*?"<>|]/g, '-').slice(0, 128);

            try {
                const absBase = workDir;
                const targetDir = join(absBase, 'archives', safeSubDir);
                // Ensure target is within workspace
                if (!targetDir.startsWith(absBase)) {
                    await reply('⛔ 不允许访问 WORK_DIR 以外的路径。');
                    return true;
                }
                await fs.mkdir(targetDir, { recursive: true });
                const filePath = join(targetDir, `${safeTitle}.md`);

                const now = new Date();
                const dateTimeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                const fileContent = `# ${safeTitle}\n\n${rawContent}\n\n---\n\n时间: ${dateTimeStr}\n`;

                // Append if file exists, create otherwise
                let fileExists = false;
                try { await fs.access(filePath); fileExists = true; } catch { /* new */ }
                if (fileExists) {
                    await fs.appendFile(filePath, `\n\n---\n\n${rawContent}\n\n时间: ${dateTimeStr}\n`, 'utf-8');
                } else {
                    await fs.writeFile(filePath, fileContent, 'utf-8');
                }

                const relPath = `archives/${safeSubDir}/${safeTitle}.md`;
                await reply(`✅ 已保存到 \`${relPath}\``, true);
            } catch (err: any) {
                await reply(`❌ 保存失败: ${err.message}`);
            }
            return true;
        }

        default:
            return false;
    }
    },
};
