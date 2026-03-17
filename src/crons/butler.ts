/**
 * butler.ts — Daily maintenance cron (02:00 AM)
 *
 * 1. Archive old diary files: history/YYYY-MM-DD.md → history/YYYY/MM/YYYY-MM-DD.md
 * 2. Clean empty/junk files from inbox/
 * 3. Git commit the changes
 */
import { execa } from 'execa';
import { join } from 'path';
import { promises as fs } from 'fs';
import type { CronJob } from './_base.js';
import { getVaultRoot } from './_helpers.js';

async function archiveDiary(vaultRoot: string): Promise<number> {
    const historyDir = join(vaultRoot, 'history');
    let entries: string[];
    try {
        entries = await fs.readdir(historyDir);
    } catch {
        return 0;
    }

    const todayFile = `${new Date().toISOString().slice(0, 10)}.md`;
    const excluded = new Set(['日记模版.md', todayFile]);
    let movedCount = 0;

    for (const entry of entries) {
        if (!entry.endsWith('.md') || excluded.has(entry)) continue;
        if (entry.length !== 13) continue;
        const year = entry.slice(0, 4);
        const month = entry.slice(5, 7);
        if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || entry[4] !== '-') continue;

        const src = join(historyDir, entry);
        const targetDir = join(historyDir, year, month);
        await fs.mkdir(targetDir, { recursive: true });
        await fs.rename(src, join(targetDir, entry));
        movedCount++;
    }
    return movedCount;
}

async function cleanInbox(vaultRoot: string): Promise<number> {
    const inboxDir = join(vaultRoot, 'inbox');
    let deletedCount = 0;

    const walk = async (dir: string): Promise<void> => {
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry === '.DS_Store' || entry.startsWith('._')) continue;
            const fullPath = join(dir, entry);
            const stat = await fs.stat(fullPath).catch(() => null);
            if (!stat) continue;
            if (stat.isDirectory()) {
                await walk(fullPath);
                continue;
            }
            if (stat.size === 0) {
                await fs.unlink(fullPath).catch(() => {});
                deletedCount++;
            } else if (entry.endsWith('.md') && stat.size < 10) {
                const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
                if (!content.trim()) {
                    await fs.unlink(fullPath).catch(() => {});
                    deletedCount++;
                }
            }
        }
    };

    await walk(inboxDir);
    return deletedCount;
}

async function gitCommit(vaultRoot: string): Promise<string> {
    try {
        const status = await execa('git', ['status', '--porcelain'], { cwd: vaultRoot });
        if (!status.stdout.trim()) return '✓ 工作区干净，无需提交。';

        await execa('git', ['add', 'history/'], { cwd: vaultRoot }).catch(() => {});
        await execa('git', ['add', 'inbox/'], { cwd: vaultRoot }).catch(() => {});

        const diff = await execa('git', ['diff', '--cached', '--quiet'], { cwd: vaultRoot }).catch((e: any) => e);
        if (diff.exitCode === 0) return '✓ history 和 inbox 目录下无实质变更。';

        await execa('git', ['commit', '-m', 'chore: 🤖 管家日常清扫'], { cwd: vaultRoot });
        return '✅ 已成功固化管家清扫的里程碑版本。';
    } catch (e: any) {
        return `❌ Git 执行失败: ${e.message}`;
    }
}

async function runMaintenance(): Promise<string> {
    const vaultRoot = getVaultRoot();
    const logs: string[] = [];

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    logs.push(`🕰️ [${timeStr}] 🤖 管家开始日常巡检。`);

    const archivedCount = await archiveDiary(vaultRoot);
    logs.push(archivedCount > 0
        ? `➡️ 归档历史日记: ${archivedCount} 篇`
        : '✓ 没有需要归档的旧日记。');

    const deletedCount = await cleanInbox(vaultRoot);
    logs.push(deletedCount > 0
        ? `🗑️ 清理 Inbox 垃圾碎片: ${deletedCount} 份`
        : '✓ Inbox 保持清洁，未发现垃圾。');

    if (archivedCount > 0 || deletedCount > 0) {
        logs.push(await gitCommit(vaultRoot));
    }

    logs.push('\n✨ 巡检完毕，您的知识库一尘不染。');
    return logs.join('\n');
}

export const butlerCron: CronJob = {
    name: 'Butler daily maintenance',
    schedule: '0 2 * * *',
    handler: async (deps) => {
        const report = await runMaintenance();
        await deps.sendReply(deps.chatId, `📅 **每日管家巡检报告**:\n\n${report}`);
    },
};
