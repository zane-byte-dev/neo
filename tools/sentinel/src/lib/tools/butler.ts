import fs from 'fs/promises';
import path from 'path';
import { execa } from 'execa';

// Get the root of the entire vault (two levels up from tools/sentinel)
const getProjectRoot = (): string => {
    // __dirname logic equivalent for ES modules running via tsx
    return path.resolve(process.cwd(), '../..');
};

/**
 * 自动归档历史日记到 YYYY/MM 目录
 */
async function archiveDiary(projectRoot: string): Promise<number> {
    const historyDir = path.join(projectRoot, 'history');
    let movedCount = 0;

    try {
        const stats = await fs.stat(historyDir);
        if (!stats.isDirectory()) return 0;
    } catch {
        return 0; // Dir doesn't exist
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const todayFile = `${todayStr}.md`;
    const excludeFiles = ['日记模版.md', todayFile];

    const files = await fs.readdir(historyDir);

    for (const filename of files) {
        if (!filename.endsWith('.md') || excludeFiles.includes(filename)) {
            continue;
        }

        // Format: YYYY-MM-DD.md
        if (filename.length === 13 && /^\d{4}-\d{2}/.test(filename)) {
            const year = filename.substring(0, 4);
            const month = filename.substring(5, 7);

            const targetDir = path.join(historyDir, year, month);
            await fs.mkdir(targetDir, { recursive: true });

            const sourcePath = path.join(historyDir, filename);
            const targetPath = path.join(targetDir, filename);

            await fs.rename(sourcePath, targetPath);
            movedCount++;
        }
    }

    return movedCount;
}

/**
 * 清理 inbox 中的空文件和无价值垃圾碎片
 */
async function cleanInbox(projectRoot: string): Promise<number> {
    const inboxDir = path.join(projectRoot, 'inbox');
    let deletedCount = 0;

    try {
        const stats = await fs.stat(inboxDir);
        if (!stats.isDirectory()) return 0;
    } catch {
        return 0; // Dir doesn't exist
    }

    // A simple recursive dir walk for Node.js
    async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else {
                // Skip system files
                if (entry.name === '.DS_Store' || entry.name.startsWith('._')) {
                    continue;
                }

                try {
                    const stats = await fs.stat(fullPath);
                    if (stats.size === 0) {
                        await fs.unlink(fullPath);
                        deletedCount++;
                    } else if (entry.name.endsWith('.md') && stats.size < 10) {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        if (!content.trim()) {
                            await fs.unlink(fullPath);
                            deletedCount++;
                        }
                    }
                } catch (e) {
                    console.error(`[Butler] Error processing file ${entry.name}:`, e);
                }
            }
        }
    }

    await walk(inboxDir);
    return deletedCount;
}

/**
 * 将变更提交至 Git
 */
async function gitCommit(projectRoot: string): Promise<string> {
    try {
        // Run git status to see if anything changed
        const { stdout: statusOut } = await execa('git', ['status', '--porcelain'], { cwd: projectRoot });

        if (!statusOut.trim()) {
            return '✓ 工作区干净，无需提交。';
        }

        await execa('git', ['add', 'history/'], { cwd: projectRoot });
        await execa('git', ['add', 'inbox/'], { cwd: projectRoot });

        // Check if there are cached changes
        try {
            await execa('git', ['diff', '--cached', '--quiet'], { cwd: projectRoot });
            // If exit code is 0, no changes were added
            return '✓ history 和 inbox 目录下无实质变更。';
        } catch (e: any) {
            // Exit code 1 means there are changes!
            if (e.exitCode === 1) {
                await execa('git', ['commit', '-m', 'chore: 🤖 管家日常清扫'], { cwd: projectRoot });
                return '✅ 已成功固化管家清扫的里程碑版本。';
            }
            throw e;
        }

    } catch (e: any) {
        return `❌ Git 执行失败: ${e.message}`;
    }
}

/**
 * 暴露给外部 (Telegram / CLI) 的聚合入口
 */
export async function runMaintenance(): Promise<string> {
    try {
        const projectRoot = getProjectRoot();
        const logs: string[] = [];

        const timeStr = new Date().toLocaleString('zh-CN');
        logs.push(`🕰️ [${timeStr}] 🤖 管家开始日常巡检。`);

        const archivedCount = await archiveDiary(projectRoot);
        if (archivedCount > 0) {
            logs.push(`➡️ 归档历史日记: ${archivedCount} 篇`);
        } else {
            logs.push(`✓ 没有需要归档的旧日记。`);
        }

        const deletedCount = await cleanInbox(projectRoot);
        if (deletedCount > 0) {
            logs.push(`❌ 清理 Inbox 垃圾碎片: ${deletedCount} 份`);
        } else {
            logs.push(`✓ Inbox 保持清洁，未发现垃圾。`);
        }

        if (archivedCount > 0 || deletedCount > 0) {
            const commitResult = await gitCommit(projectRoot);
            logs.push(commitResult);
        }

        logs.push(`\n✨ 巡检完毕，您的知识库一尘不染。`);

        return logs.join('\n');
    } catch (error: any) {
        return `❌ 管家巡检过程中发生严重错误: ${error.message || error}`;
    }
}
