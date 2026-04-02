/**
 * edit-file.ts — Targeted string-replacement file editing tool.
 *
 * More precise than write_file: only modifies the matched section,
 * leaving the rest of the file untouched. Essential for large files.
 */
import { promises as fs } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import type { Tool } from './_base.js';

export const editFileTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'edit_file',
        description:
            '精确替换文件中的一段文本（old_str → new_str）。比 write_file 更安全：只修改匹配的片段，其余内容原封不动。\n' +
            '规则：\n' +
            '• old_str 必须在文件中唯一匹配（包括空格、缩进）\n' +
            '• 如果 old_str 传空字符串，则向文件末尾追加 new_str\n' +
            '• 如果文件不存在且 old_str 为空，则创建文件\n' +
            '先用 read_file 确认文件内容，再调用本工具进行修改。',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '文件路径（绝对路径或相对于 workDir 的路径）',
                },
                old_str: {
                    type: 'string',
                    description: '要替换的原始文本，必须在文件中唯一匹配（含空白符）。传空字符串则追加 new_str 到文件末尾。',
                },
                new_str: {
                    type: 'string',
                    description: '替换后的新文本。可以为空字符串（相当于删除 old_str）。',
                },
            },
            required: ['path', 'old_str', 'new_str'],
        },
    },
    handler: async (args, workDir) => {
        const filePath = String(args.path ?? '');
        const oldStr = String(args.old_str ?? '');
        const newStr = String(args.new_str ?? '');

        if (!filePath) return '[Error] path is required';

        const resolved = isAbsolute(filePath) ? filePath : join(workDir, filePath);

        // Append / create mode (old_str is empty)
        if (oldStr === '') {
            let existing = '';
            try {
                existing = await fs.readFile(resolved, 'utf8');
            } catch (err: any) {
                if (err.code !== 'ENOENT') return `[Error] Cannot read file: ${err.message}`;
            }
            await fs.mkdir(dirname(resolved), { recursive: true });
            await fs.writeFile(resolved, existing + newStr, 'utf8');
            return `OK: ${existing ? 'appended' : 'created'} file ${resolved} (${newStr.length} chars)`;
        }

        let content: string;
        try {
            content = await fs.readFile(resolved, 'utf8');
        } catch (err: any) {
            return `[Error] Cannot read file: ${err.message}`;
        }

        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) {
            return `[Error] old_str not found in file. Verify the text matches exactly (whitespace, indentation, line endings).`;
        }
        if (occurrences > 1) {
            return `[Error] old_str matches ${occurrences} locations — add more surrounding context to make it unique.`;
        }

        const updated = content.replace(oldStr, newStr);
        await fs.writeFile(resolved, updated, 'utf8');

        const oldLines = oldStr.split('\n').length;
        const newLines = newStr.split('\n').length;
        const delta = newLines - oldLines;
        const deltaStr = delta > 0 ? `+${delta}` : String(delta);
        return `OK: edited ${resolved} (${deltaStr} lines)`;
    },
};
