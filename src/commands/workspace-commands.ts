import { join, resolve } from 'path';
import { promises as fs } from 'fs';
import { SKIP_DIRS } from '../config.js';
import type { Command } from './_base.js';

export const workspaceCommand: Command = {
    commands: ['/ls', '/read', '/note', '/today', '/task', '/search', '/weekly'],
    handler: async (command, text, ctx, deps) => {
    switch (command) {
        case '/ls': {
            const workDir = process.env.WORK_DIR;
            if (!workDir) {
                await ctx.reply('⚠️ WORK_DIR 未配置。');
                return true;
            }
            const rawArg = text.split(' ').slice(1).join(' ').trim();
            const safeSuffix = rawArg.replace(/^[./\\]+/, '');
            const targetDir = safeSuffix ? join(workDir, safeSuffix) : workDir;
            const resolvedTarget = resolve(targetDir);
            const resolvedBase = resolve(workDir);
            if (!resolvedTarget.startsWith(resolvedBase)) {
                await ctx.reply('⛔ 不允许访问 WORK_DIR 以外的路径。');
                return true;
            }
            try {
                const entries = await fs.readdir(resolvedTarget, { withFileTypes: true });
                if (entries.length === 0) {
                    await ctx.reply(`📂 ${safeSuffix || '/'} 目录为空。`);
                    return true;
                }
                const lines = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
                const displayPath = safeSuffix || '(workspace root)';
                await ctx.reply(`📂 ${displayPath}\n\n` + lines.join('\n'));
            } catch (err: any) {
                await ctx.reply(`❌ 无法读取目录: ${err.message}`);
            }
            return true;
        }

        case '/read': {
            const workDir = process.env.WORK_DIR;
            if (!workDir) {
                await ctx.reply('⚠️ WORK_DIR 未配置。');
                return true;
            }
            const rawArg = text.split(' ').slice(1).join(' ').trim();
            if (!rawArg) {
                await ctx.reply('用法: /read <路径或关键词>\n例: /read 随手记  /read inbox/note.md');
                return true;
            }
            const resolvedBase = resolve(workDir);

            const sendFile = async (absPath: string, label: string) => {
                const stat = await fs.stat(absPath);
                if (stat.size > 100 * 1024) {
                    await ctx.reply(`⚠️ 文件超过 100KB（${(stat.size / 1024).toFixed(1)}KB），请缩小范围。`);
                    return;
                }
                const content = await fs.readFile(absPath, 'utf8');
                const MAX_MSG = 4000;
                const header = `📄 ${label}\n\n`;
                if (header.length + content.length <= MAX_MSG) {
                    await ctx.reply(header + content);
                } else {
                    const chunks: string[] = [];
                    for (let i = 0; i < content.length; i += MAX_MSG - header.length) {
                        chunks.push(content.slice(i, i + MAX_MSG - header.length));
                    }
                    await ctx.reply(`📄 ${label} (${chunks.length} 段)\n\n${chunks[0]}`);
                    for (let i = 1; i < chunks.length; i++) {
                        await ctx.reply(chunks[i]).catch(() => {});
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
                            await ctx.reply(`📂 ${safeSuffix} 目录为空。`);
                        } else {
                            const lines = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
                            await ctx.reply(`📂 ${safeSuffix}\n\n` + lines.join('\n'));
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
                await ctx.reply(`🔍 未找到匹配 "${rawArg}" 的文件。`);
            } else if (matches.length === 1) {
                const relPath = matches[0].slice(resolvedBase.length + 1);
                await sendFile(matches[0], relPath);
            } else {
                const MAX_SHOW = 10;
                const shown = matches.slice(0, MAX_SHOW);
                const lines = shown.map((p, i) => `${i + 1}. ${p.slice(resolvedBase.length + 1)}`);
                const suffix = matches.length > MAX_SHOW ? `\n\n...还有 ${matches.length - MAX_SHOW} 个，请缩窄关键词` : '';
                await ctx.reply(`🔍 找到 ${matches.length} 个匹配文件：\n\n${lines.join('\n')}${suffix}\n\n回复序号直接阅读，例如发送 "r1" 读取第1个，"r2" 读取第2个。`);
                deps.pendingReadMatches.set(ctx.chat.id, { matches: shown, expiry: Date.now() + 120_000 });
            }
            return true;
        }

        case '/note': {
            const workDir = process.env.WORK_DIR;
            if (!workDir) {
                await ctx.reply('⚠️ WORK_DIR 未配置。');
                return true;
            }
            const noteContent = text.replace(/^\/note\s*/i, '').trim();
            if (!noteContent) {
                await ctx.reply('用法: `/note <内容>`\n\n快速追加一条碎片到今日 Inbox，不经过 AI。', { parse_mode: 'Markdown' });
                return true;
            }
            try {
                const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
                const inboxDir = join(resolve(workDir), '0-Inbox');
                await fs.mkdir(inboxDir, { recursive: true });
                const inboxFile = join(inboxDir, `${today}.md`);
                const timeStr = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
                let fileExists = false;
                try { await fs.access(inboxFile); fileExists = true; } catch { /* new file */ }
                const entry = fileExists
                    ? `\n- ${timeStr} ${noteContent}\n`
                    : `# ${today} Inbox\n\n- ${timeStr} ${noteContent}\n`;
                await fs.appendFile(inboxFile, entry, 'utf-8');
                await ctx.reply(`✅ 已记入 0-Inbox/${today}.md`);
            } catch (err: any) {
                await ctx.reply(`❌ 写入失败: ${err.message}`);
            }
            return true;
        }

        case '/today': {
            const workDir = process.env.WORK_DIR;
            if (!workDir) {
                await ctx.reply('⚠️ WORK_DIR 未配置。');
                return true;
            }
            const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
            const absWorkDir = resolve(workDir);
            const inboxPath = join(absWorkDir, '0-Inbox', `${today}.md`);
            const dailyPath = join(absWorkDir, '1-Daily', `${today}.md`);

            const readOrNull = async (p: string) => {
                try { return await fs.readFile(p, 'utf-8'); }
                catch { return null; }
            };

            const inbox = await readOrNull(inboxPath);
            const daily = await readOrNull(dailyPath);

            if (!inbox && !daily) {
                await ctx.reply(`📭 今天（${today}）还没有任何记录。\n\n用 \`/note <内容>\` 开始记录。`, { parse_mode: 'Markdown' });
                return true;
            }

            const MAX = 3500;
            if (inbox) {
                const header = `📥 **0-Inbox/${today}.md**\n\n`;
                const body = inbox.length > MAX ? inbox.slice(0, MAX) + '\n...(已截断)' : inbox;
                await ctx.reply(header + body, { parse_mode: 'Markdown' }).catch(() =>
                    ctx.reply(header + body));
            }
            if (daily) {
                const header = `📓 **1-Daily/${today}.md**\n\n`;
                const body = daily.length > MAX ? daily.slice(0, MAX) + '\n...(已截断)' : daily;
                await ctx.reply(header + body, { parse_mode: 'Markdown' }).catch(() =>
                    ctx.reply(header + body));
            }
            return true;
        }

        case '/task': {
            const workDir = process.env.WORK_DIR;
            if (!workDir) { await ctx.reply('⚠️ WORK_DIR 未配置。'); return true; }
            const taskContent = text.replace(/^\/task\s*/i, '').trim();
            if (!taskContent) {
                await ctx.reply('用法: `/task <内容>`\n\n快速追加一条任务到 2-Tasks，不经过 AI。', { parse_mode: 'Markdown' });
                return true;
            }
            try {
                const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
                const tasksDir = join(resolve(workDir), '2-Tasks');
                await fs.mkdir(tasksDir, { recursive: true });
                const tasksFile = join(tasksDir, 'tasks.md');
                const timeStr = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
                let fileExists = false;
                try { await fs.access(tasksFile); fileExists = true; } catch { /* new file */ }
                const entry = fileExists
                    ? `\n- [ ] ${taskContent}  _(${today} ${timeStr})_\n`
                    : `# Tasks\n\n- [ ] ${taskContent}  _(${today} ${timeStr})_\n`;
                await fs.appendFile(tasksFile, entry, 'utf-8');
                await ctx.reply('✅ 任务已记入 2-Tasks/tasks.md');
            } catch (err: any) {
                await ctx.reply(`❌ 写入失败: ${err.message}`);
            }
            return true;
        }

        case '/search': {
            const workDir = process.env.WORK_DIR;
            if (!workDir) { await ctx.reply('⚠️ WORK_DIR 未配置。'); return true; }
            const query = text.replace(/^\/search\s*/i, '').trim();
            if (!query) {
                await ctx.reply('用法: `/search <关键词>`\n\n全文搜索 vault 中所有 .md 文件。', { parse_mode: 'Markdown' });
                return true;
            }
            const absBase = resolve(workDir);
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
                await ctx.reply(`🔍 未找到包含 "${query}" 的内容。`);
            } else {
                const lines = hits.map(h => `📄 \`${h.file}\` L${h.line}\n   ${h.snippet}`);
                await ctx.reply(
                    `🔍 **"${query}"** 找到 ${hits.length} 处匹配：\n\n` + lines.join('\n\n'),
                    { parse_mode: 'Markdown' }
                ).catch(() =>
                    ctx.reply(`🔍 "${query}" 找到 ${hits.length} 处：\n\n` + hits.map(h => `${h.file}:${h.line}  ${h.snippet}`).join('\n\n'))
                );
            }
            return true;
        }

        case '/weekly': {
            const statusMsg = await ctx.reply('⏳ 正在生成本周周报...');
            try {
                const projectRoot = process.cwd();
                const vaultEnv = { ...process.env };
                const { execa: _execa } = await import('execa');
                const result = await _execa('npx', ['tsx', join(projectRoot, 'apps/refinery/weekly-report.ts')], { env: vaultEnv });
                const output = result.stdout?.trim() || '（无输出）';
                await deps.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined,
                    output.slice(0, 4000)
                ).catch(() => ctx.reply(output.slice(0, 4000)));
            } catch (err: any) {
                await deps.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined,
                    `❌ 周报生成失败: ${err.message}`
                ).catch(() => {});
            }
            return true;
        }

        default:
            return false;
    }
    },
};
