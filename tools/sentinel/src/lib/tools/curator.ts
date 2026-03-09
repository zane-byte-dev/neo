import fs from 'fs/promises';
import path from 'path';
import { GeminiClient } from '../gemini-client.js';

const getProjectRoot = (): string => {
    // Priority 1: Environment variable set in .env
    if (process.env.GEMINI_WORK_DIR) {
        return process.env.GEMINI_WORK_DIR;
    }
    // Fallback: Assume we are running from tools/sentinel/dist/lib/tools/ or tools/sentinel/src/lib/tools/
    // Project root is 3 levels up from Sentinel root
    return path.resolve(process.cwd(), '../..');
};

/**
 * 获取所有被归档的 Markdown 日记文件路径
 */
async function getArchivedDiaries(projectRoot: string): Promise<string[]> {
    const historyDir = path.join(projectRoot, 'history');
    const allFiles: string[] = [];

    try {
        const stats = await fs.stat(historyDir);
        if (!stats.isDirectory()) return [];
    } catch {
        return [];
    }

    async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Ignore the loose unarchived diaries in 'history/' or '历史版本' etc
                if (entry.name.match(/^\d{4}$/) || entry.name.match(/^\d{2}$/)) {
                    await walk(fullPath);
                }
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                allFiles.push(fullPath);
            }
        }
    }

    // Only walk into Year/Month subdirectories
    const rootSubdirs = await fs.readdir(historyDir, { withFileTypes: true });
    for (const subdir of rootSubdirs) {
        if (subdir.isDirectory() && subdir.name.match(/^\d{4}$/)) {
            await walk(path.join(historyDir, subdir.name));
        }
    }

    return allFiles;
}

/**
 * 随机获取 n 篇指定的数组元素
 */
function getRandomItems<T>(arr: T[], count: number): T[] {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

/**
 * 主流程：抽取历史日记并调用 Gemini 生成策展文案
 */
export async function runCurator(): Promise<string> {
    try {
        const projectRoot = getProjectRoot();

        // 1. 查找历史归档
        const archives = await getArchivedDiaries(projectRoot);
        if (archives.length === 0) {
            return '⚠️ [策展人] 未在归档库 (history/YYYY/MM) 中发现任何旧日记，无法完成策展。';
        }

        // 2. 随机抽取 1 篇
        const selectedFiles = getRandomItems(archives, 1);
        const selectedFile = selectedFiles[0];

        // 解析文件名里的日期 (e.g. 2024-05-12.md)
        const fileName = path.basename(selectedFile, '.md');
        let content = await fs.readFile(selectedFile, 'utf-8');

        // 截断太长的日记（Gemini CLI 传参容易超限或处理慢）
        if (content.length > 3000) {
            content = content.substring(0, 3000) + '... (内容已截断)';
        }

        // 3. 构造请求
        const promptContext = `
[任务：每日策展]
时间线：这里有一篇尘封在历史归档中的旧日记，写于【${fileName}】。
内容如下：
---
${content}
---

要求：
1. 请你以“策展人”(Curator)的身份阅读这篇旧日记。
2. 从中萃取出 1-2 个闪光点或者和当下（${new Date().toLocaleDateString('zh-CN')}）有跨时空连线意义的内容。
3. 请以温和、睿智的老友口吻，写一段 100-200 字以内的点评和感悟，通过你的导读将它推给我。
4. 语言必须干净、直接，切忌长篇大论。
`.trim();

        console.log(`[Curator] 正在召唤策展人... (精选文件: ${fileName})`);

        // 4. 发起 Gemini 调用
        const geminiCli = new GeminiClient();
        if (!geminiCli.isEnabled()) {
            return '❌ [策展人] 无法唤醒 Gemini 核心引擎，请检查 CLI 路径。';
        }

        const response = await geminiCli.generateResponse(promptContext);

        if (!response || response.includes("⚠️") || response.includes("🔥")) {
            return `❌ [策展人] 唤醒失败或无思考产出：${response}`;
        }

        // 5. 组装输出
        const report = `🕰️ **时空连线：来自 \`${fileName}\` 的只言片语**\n\n` +
            `${response}\n\n` +
            `--- \n_*(由 NeoAgent 策展代理自动从归档区中挖掘并精炼)*_`;

        return report;

    } catch (e: any) {
        return `❌ [策展人] 遭遇严重错误导致策展中断: ${e.message}`;
    }
}
