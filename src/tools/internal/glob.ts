/**
 * glob.ts — File path pattern matching tool.
 *
 * Find files by name pattern. Supports:
 * - * for single directory level wildcard
 * - ** for multi-level wildcard
 * - ? for single character wildcard
 * - {a,b} for alternation
 */
import { promises as fs } from 'fs';
import { join, isAbsolute } from 'path';
import type { Tool } from '../_base.js';
import { matchesGlob, walkDirEntries } from '../../utils/file-search.js';

export const globTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0', permission: 'read' },
    declaration: {
        name: 'glob',
        description:
            '按 glob 模式匹配文件路径，用于定位文件。\n' +
            '支持：* (单级)、** (多级)、? (单字符)、{a,b} (多选)\n' +
            '示例：\n' +
            '• "*.ts" — 当前目录下的 .ts 文件\n' +
            '• "**/*.test.ts" — 所有测试文件\n' +
            '• "src/**/*.{ts,tsx}" — src 下所有 TypeScript 文件\n' +
            '• "docs/*.md" — docs 目录下的 Markdown 文件',
        parameters: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Glob 模式，如 "**/*.ts"、"src/*.md"、"**/*.{json,yaml}"',
                },
                path: {
                    type: 'string',
                    description: '搜索根目录（默认 workDir）',
                },
                max_results: {
                    type: 'number',
                    description: '最多返回文件数（默认 200）',
                },
            },
            required: ['pattern'],
        },
    },
    handler: async (args, workDir) => {
        const pattern = String(args.pattern ?? '');
        if (!pattern) return '[Error] pattern is required';

        const rawPath = args.path ? String(args.path) : null;
        const searchRoot = rawPath
            ? (isAbsolute(rawPath) ? rawPath : join(workDir, rawPath))
            : workDir;
        const maxResults = Math.min(1000, Number(args.max_results ?? 200));

        let stat;
        try {
            stat = await fs.stat(searchRoot);
        } catch {
            return `[Error] Path not found: ${searchRoot}`;
        }
        if (!stat.isDirectory()) {
            return `[Error] Path is not a directory: ${searchRoot}`;
        }

        const results: string[] = [];
        for await (const entry of walkDirEntries(searchRoot, { maxDepth: 15 })) {
            if (!matchesGlob(entry.relPath, pattern) && !matchesGlob(entry.name, pattern)) continue;
            results.push(entry.relPath);
            if (results.length >= maxResults) break;
        }

        if (results.length === 0) return `No files matching "${pattern}"`;

        const suffix = results.length >= maxResults ? ` (showing first ${maxResults})` : '';
        return `${results.length} file(s) matching "${pattern}"${suffix}:\n\n` + results.join('\n');
    },
};
