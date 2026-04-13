#!/usr/bin/env node
/**
 * update-now — 更新 memory/NOW.md 短期记忆文件
 * stdin: JSON { args: { content }, context: { workDir } }
 * stdout: JSON { type: 'text', content: '...' }
 */
const fs = require('fs');
const path = require('path');

async function main() {
    const raw = await new Promise((resolve) => {
        let data = '';
        process.stdin.on('data', (chunk) => (data += chunk));
        process.stdin.on('end', () => resolve(data));
    });

    const { args, context } = JSON.parse(raw);
    const content = (args.content ?? '').trim();
    if (!content) {
        console.log(JSON.stringify({ type: 'error', content: 'content is required' }));
        return;
    }

    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let finalContent = content.trimEnd();
    if (!finalContent.includes('*Updated:')) {
        finalContent += `\n\n---\n*Updated: ${timestamp}*\n`;
    }

    const outDir = path.join(context.workDir, 'memory');
    const outPath = path.join(outDir, 'NOW.md');

    try {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outPath, finalContent, 'utf-8');
        console.log(JSON.stringify({
            type: 'text',
            content: `✅ NOW.md 已更新（${finalContent.length} 字符）。`,
        }));
    } catch (err) {
        console.log(JSON.stringify({ type: 'error', content: `更新 NOW.md 失败: ${err.message}` }));
    }
}

main();
