import { promises as fs } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { Tool } from './_base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _PROJECT_ROOT = resolve(__dirname, '../..');

function getKbDir(workDir: string): string {
    const rawResourceDir = process.env.RESOURCE_DIR ?? '';
    const resourceDir = rawResourceDir
        ? (isAbsolute(rawResourceDir) ? rawResourceDir : resolve(_PROJECT_ROOT, rawResourceDir))
        : join(workDir, 'project/@reference');
    return join(resourceDir, 'xifeng-km');
}

export const findInKmTool: Tool = {
    meta: { category: 'knowledge', version: '1.0.0' },
    declaration: {
        name: 'find_in_km',
        description:
            '访问西风知识库(xifeng-km)。\n' +
            '• 不传 files → 返回所有文章的文件名列表，供选择\n' +
            '• 传入 files → 返回指定文章的完整内容',
        parameters: {
            type: 'object',
            properties: {
                files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要读取的文章文件名列表（如 ["007_字越少，事越大22_3_9.md"]），不传则只列目录',
                },
            },
        },
    },
    handler: async (args, workDir) => {
        const kbDir = getKbDir(workDir);

        // List mode: no files specified
        if (!args.files || (Array.isArray(args.files) && args.files.length === 0)) {
            try {
                const all = (await fs.readdir(kbDir))
                    .filter(f => f.endsWith('.md') && f !== '00_目录.md')
                    .sort();
                return `西风知识库共 ${all.length} 篇文章：\n\n` + all.join('\n');
            } catch {
                return '[Error] 知识库目录不存在或无法读取。请检查 RESOURCE_DIR 环境变量。';
            }
        }

        // Read mode: fetch specific files
        const requestedFiles = (args.files as string[]).slice(0, 5); // safety cap
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
