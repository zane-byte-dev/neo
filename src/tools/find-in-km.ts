import { promises as fs } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { RESOURCE_DIR } from '../config.js';
import type { Tool } from './_base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _PROJECT_ROOT = resolve(__dirname, '../..');

function getKbDir(workDir: string): string {
    const resourceDir = RESOURCE_DIR
        ? (isAbsolute(RESOURCE_DIR) ? RESOURCE_DIR : resolve(_PROJECT_ROOT, RESOURCE_DIR))
        : join(workDir, 'project/@reference');
    return join(resourceDir, 'xifeng-km');
}

export const findInKmTool: Tool = {
    meta: { category: 'knowledge', version: '1.1.0' },
    declaration: {
        name: 'find_in_km',
        description:
            '访问西风知识库(xifeng-km)。\n' +
            '• 不传任何参数 → 返回**摘要索引**（含每篇核心观点和标签），用于选文\n' +
            '• 传入 files → 返回指定文章的完整内容（最多10篇）\n' +
            '• 传入 query → 在所有文章标题+内容中关键词搜索，返回匹配片段\n' +
            '注意：先用无参调用获取摘要索引，再按需读取具体文章。',
        parameters: {
            type: 'object',
            properties: {
                files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要读取的文章文件名列表（如 ["007_字越少，事越大22_3_9.md"]），不传则返回摘要索引',
                },
                query: {
                    type: 'string',
                    description: '关键词搜索，在所有文章的标题和内容中匹配，返回含该词的文章名和上下文片段（80字）',
                },
            },
        },
    },
    handler: async (args, workDir) => {
        const kbDir = getKbDir(workDir);

        // Search mode: keyword query across all articles
        if (args.query && typeof args.query === 'string') {
            const keyword = args.query.trim();
            if (!keyword) return '[Error] query 不能为空';

            let allFiles: string[];
            try {
                allFiles = (await fs.readdir(kbDir))
                    .filter(f => f.endsWith('.md') && !f.startsWith('00_'))
                    .sort();
            } catch {
                return '[Error] 知识库目录不存在或无法读取。';
            }

            const matches: string[] = [];
            for (const fname of allFiles) {
                if (fname.includes(keyword)) {
                    matches.push(`**${fname}** （标题匹配）`);
                    continue;
                }
                try {
                    const content = await fs.readFile(join(kbDir, fname), 'utf8');
                    const idx = content.indexOf(keyword);
                    if (idx !== -1) {
                        const start = Math.max(0, idx - 40);
                        const end = Math.min(content.length, idx + 80);
                        const snippet = content.slice(start, end).replace(/\n/g, ' ');
                        matches.push(`**${fname}**\n  > …${snippet}…`);
                    }
                } catch {
                    // skip unreadable files
                }
            }

            if (matches.length === 0) return `未找到包含「${keyword}」的文章。`;
            return `关键词「${keyword}」共匹配 ${matches.length} 篇：\n\n` + matches.join('\n\n');
        }

        // List mode: no files specified → return summary index
        if (!args.files || (Array.isArray(args.files) && args.files.length === 0)) {
            try {
                const allFiles = (await fs.readdir(kbDir))
                    .filter(f => f.endsWith('.md') && !f.startsWith('00_'))
                    .sort();

                const indexPath = join(kbDir, '00_摘要索引.md');
                let indexContent: string;
                try {
                    indexContent = await fs.readFile(indexPath, 'utf8');
                } catch {
                    // fallback to plain file list
                    return `西风知识库共 ${allFiles.length} 篇文章：\n\n` + allFiles.join('\n');
                }

                // Detect files not yet referenced in the index
                const unindexed = allFiles.filter(f => !indexContent.includes(f));
                if (unindexed.length > 0) {
                    indexContent += `\n\n---\n\n⚠️ **以下文章尚未收录在摘要索引中，需要更新索引：**\n\n` +
                        unindexed.map(f => `- ${f}`).join('\n');
                }

                return indexContent;
            } catch {
                return '[Error] 知识库目录不存在或无法读取。';
            }
        }

        // Read mode: fetch specific files
        const requestedFiles = (args.files as string[]).slice(0, 10); // increased from 5
        const results: string[] = [];

        for (const fname of requestedFiles) {
            // Sanitize: only allow filenames, no path traversal
            const safeName = fname.replace(/[/\\]/g, '');
            try {
                const content = await fs.readFile(join(kbDir, safeName), 'utf8');
                const lines = content.split('\n');
                const body = lines.length > 600
                    ? lines.slice(0, 600).join('\n') + '\n...(已截断)'
                    : content;
                results.push(`### ${safeName}\n\n${body}`);
            } catch {
                results.push(`### ${safeName}\n\n[Error] 文件不存在或无法读取`);
            }
        }

        return results.join('\n\n---\n\n');
    },
};
