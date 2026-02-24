/**
 * 📚 Ebook Refinery — Convert EPUB to atomic Markdown chapters
 * Replaces tools/ebook_refinery/script.py
 *
 * Requires: pandoc installed on system (brew install pandoc)
 * Usage (direct): tsx src/lib/tools/ebook-refinery.ts <file.epub> [output_dir]
 */

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { execa } from 'execa';
import { config } from 'dotenv';

config();

function cleanContent(content: string): string {
    // Remove [text]{...} style tags (Calibre artifacts)
    let result = content;
    result = result.replace(/\[([^\]]*)\]\{[^}]*\}/g, '$1');
    result = result.replace(/\[\]\{[^}]*\}/g, '');
    result = result.replace(/\{#[^}]*\}/g, '');
    result = result.replace(/<\/?span[^>]*>/g, '');
    result = result.replace(/<\/?div[^>]*>/g, '');

    // Collapse excessive blank lines
    const lines = result.split('\n');
    const output: string[] = [];
    let lastEmpty = false;
    for (const line of lines) {
        if (line.trim()) {
            output.push(line.trim());
            lastEmpty = false;
        } else if (!lastEmpty) {
            output.push('');
            lastEmpty = true;
        }
    }

    return output.join('\n');
}

function safeFilename(title: string): string {
    return title.replace(/[/:*?"<>|]/g, '_').trim();
}

export async function ebookRefinery(epubPath: string, outputBaseDir?: string): Promise<string> {
    if (!existsSync(epubPath)) throw new Error(`File not found: ${epubPath}`);

    // Check pandoc
    const pandocCheck = await execa('which', ['pandoc'], { reject: false });
    if (pandocCheck.exitCode !== 0) throw new Error('pandoc not found. Install with: brew install pandoc');

    const vaultDir = process.env.GEMINI_WORK_DIR;
    const bookName = basename(epubPath, extname(epubPath));
    const baseDir = outputBaseDir
        ?? (vaultDir ? join(vaultDir, 'resource') : 'resource');
    const outputDir = join(baseDir, `${bookName}全集`);

    await mkdir(outputDir, { recursive: true });

    // 1. Pandoc EPUB → Markdown
    const tempMd = join(outputDir, '_full_temp.md');
    console.log(`[EbookRefinery] Converting EPUB → Markdown...`);
    await execa('pandoc', [epubPath, '-o', tempMd]);

    const fullContent = await readFile(tempMd, 'utf-8');
    await rm(tempMd);

    // 2. Split by H1 headings
    const parts = fullContent.split(/^(# .+)$/m);
    const tocLines: string[] = [`# ${bookName} - 目录\n`];
    let chapterCount = 0;

    // parts = [preamble, h1, body, h1, body, ...]
    for (let i = 1; i < parts.length; i += 2) {
        const titleLine = parts[i].trim();
        const body = parts[i + 1] ?? '';

        const cleanTitle = titleLine
            .replace(/\{#.*?\}/g, '')
            .replace(/^#\s*/, '')
            .trim();
        const safeTitle = safeFilename(cleanTitle);

        const fullText = `# ${cleanTitle}\n\n${body}`;
        const cleaned = cleanContent(fullText);

        chapterCount++;
        const fileName = `${String(chapterCount).padStart(3, '0')}_${safeTitle}.md`;
        const filePath = join(outputDir, fileName);

        await writeFile(filePath, `---\ntitle: ${cleanTitle}\ntype: chapter\nbook: ${bookName}\n---\n\n${cleaned}`, 'utf-8');
        tocLines.push(`- [[${fileName}|${cleanTitle}]]`);
    }

    // 3. Write TOC
    await writeFile(join(outputDir, '00_目录.md'), tocLines.join('\n'), 'utf-8');

    return `📚 炼制完成！共 ${chapterCount} 个章节\n📂 输出目录：${outputDir}`;
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const epubPath = process.argv[2];
    if (!epubPath) { console.error('Usage: tsx ebook-refinery.ts <file.epub> [output_dir]'); process.exit(1); }
    console.log(`📚 Ebook Refinery starting...`);
    const result = await ebookRefinery(epubPath, process.argv[3]);
    console.log(result);
}
