/**
 * grep.ts — Recursive file content search tool.
 *
 * Searches files by regex pattern. Supports:
 * - output_mode: "files" (default), "content" (with context), "count"
 * - glob filter (e.g. "*.ts")
 * - case sensitivity toggle
 * - context lines around matches
 */
import { promises as fs } from 'fs';
import { join, isAbsolute } from 'path';
import type { Tool } from './_base.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', 'cache', '__pycache__', '.next']);

async function* walkDir(dir: string, depth = 0, maxDepth = 10): AsyncGenerator<string> {
    if (depth > maxDepth) return;
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (e.name.startsWith('.') && depth > 0) continue;
        if (SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            yield* walkDir(full, depth + 1, maxDepth);
        } else if (e.isFile()) {
            yield full;
        }
    }
}

function matchesGlob(filePath: string, pattern: string): boolean {
    // Convert glob to regex: support *, **, ?
    const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\x00')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\x00/g, '.*');
    try {
        return new RegExp(`(^|/)${regexStr}$`).test(filePath);
    } catch {
        return false;
    }
}

export const grepTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'grep',
        description:
            '在文件内容中搜索正则表达式模式（类似 grep/ripgrep）。\n' +
            '• output_mode: "files"（默认，只返回文件名）| "content"（返回匹配行）| "count"（每文件匹配数）\n' +
            '• glob: 文件名过滤，如 "*.ts"、"*.md"\n' +
            '• context_lines: content 模式下匹配行前后显示的行数\n' +
            '• case_sensitive: 默认 true',
        parameters: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: '正则表达式，如 "TODO|FIXME"、"function\\s+\\w+"',
                },
                path: {
                    type: 'string',
                    description: '搜索目录或文件（默认 workDir）',
                },
                glob: {
                    type: 'string',
                    description: '文件名 glob 过滤，如 "*.ts"、"**/*.md"',
                },
                output_mode: {
                    type: 'string',
                    description: '"files"（默认）、"content"（含匹配行）、"count"（匹配数）',
                },
                context_lines: {
                    type: 'number',
                    description: '匹配行前后显示的行数（仅 content 模式，默认 0）',
                },
                case_sensitive: {
                    type: 'string',
                    description: '"true"（默认）或 "false"',
                },
                max_results: {
                    type: 'number',
                    description: '最多返回结果数（默认 100）',
                },
            },
            required: ['pattern'],
        },
    },
    handler: async (args, workDir) => {
        const pattern = String(args.pattern ?? '');
        if (!pattern) return '[Error] pattern is required';

        const rawPath = args.path ? String(args.path) : null;
        const searchPath = rawPath
            ? (isAbsolute(rawPath) ? rawPath : join(workDir, rawPath))
            : workDir;
        const globFilter = args.glob ? String(args.glob) : null;
        const outputMode = (String(args.output_mode ?? 'files')) as 'files' | 'content' | 'count';
        const contextLines = Math.max(0, Number(args.context_lines ?? 0));
        const caseSensitive = String(args.case_sensitive ?? 'true') !== 'false';
        const maxResults = Math.min(500, Number(args.max_results ?? 100));

        let regex: RegExp;
        try {
            regex = new RegExp(pattern, caseSensitive ? '' : 'i');
        } catch (e: any) {
            return `[Error] Invalid regex: ${e.message}`;
        }

        let stat;
        try {
            stat = await fs.stat(searchPath);
        } catch {
            return `[Error] Path not found: ${searchPath}`;
        }

        const filesToSearch: string[] = [];
        if (stat.isFile()) {
            filesToSearch.push(searchPath);
        } else {
            for await (const f of walkDir(searchPath)) {
                if (globFilter && !matchesGlob(f, globFilter)) continue;
                filesToSearch.push(f);
            }
        }

        const outputLines: string[] = [];
        let totalMatches = 0;
        let fileMatchCount = 0;

        for (const file of filesToSearch) {
            let content: string;
            try {
                content = await fs.readFile(file, 'utf8');
            } catch {
                continue;
            }
            // Skip binary files
            if (content.includes('\x00')) continue;

            const lines = content.split('\n');
            const matchingLineIdxs: number[] = [];
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) matchingLineIdxs.push(i);
            }
            if (matchingLineIdxs.length === 0) continue;

            totalMatches += matchingLineIdxs.length;
            fileMatchCount++;

            const relPath = file.startsWith(searchPath)
                ? file.slice(searchPath.length + 1)
                : file;

            if (outputMode === 'files') {
                outputLines.push(relPath);
                if (outputLines.length >= maxResults) break;
            } else if (outputMode === 'count') {
                outputLines.push(`${relPath}: ${matchingLineIdxs.length}`);
            } else {
                // content mode with context
                const shown = new Set<number>();
                for (const li of matchingLineIdxs) {
                    for (let c = Math.max(0, li - contextLines); c <= Math.min(lines.length - 1, li + contextLines); c++) {
                        shown.add(c);
                    }
                }
                const block: string[] = [`${relPath}:`];
                let prev = -2;
                for (const li of Array.from(shown).sort((a, b) => a - b)) {
                    if (li > prev + 1 && prev >= 0) block.push('  --');
                    const mark = matchingLineIdxs.includes(li) ? '> ' : '  ';
                    block.push(`${mark}${li + 1}: ${lines[li]}`);
                    prev = li;
                }
                outputLines.push(block.join('\n'));
                if (outputLines.length >= maxResults) break;
            }
        }

        if (outputLines.length === 0) {
            return `No matches found for "${pattern}"`;
        }

        const header = outputMode === 'files'
            ? `${fileMatchCount} file(s) match "${pattern}":\n\n`
            : outputMode === 'count'
                ? `${totalMatches} match(es) across ${fileMatchCount} file(s):\n\n`
                : `${totalMatches} match(es) in ${fileMatchCount} file(s):\n\n`;

        return header + outputLines.join('\n');
    },
};
