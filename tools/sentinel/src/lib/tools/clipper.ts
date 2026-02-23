/**
 * ✂️ Clipper — Fetch a webpage and save it as Markdown to vault
 * Replaces tools/clipper/script.py
 *
 * Usage (direct): tsx src/lib/tools/clipper.ts <url> [target_dir]
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config();

function sanitizeFilename(title: string): string {
    return title.replace(/[\\/*?:<>|"]/g, '').trim().substring(0, 100);
}

async function fetchMarkdown(url: string): Promise<{ title: string; content: string }> {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/markdown' },
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`Jina API returned ${res.status}`);
    const content = await res.text();

    // Extract title from first 10 lines
    let title = 'Untitled Clipper';
    for (const line of content.split('\n').slice(0, 10)) {
        if (line.startsWith('Title: ')) { title = line.slice(7).trim(); break; }
        if (line.startsWith('# ')) { title = line.slice(2).trim(); break; }
    }

    return { title, content };
}

export async function clipUrl(url: string, targetDir?: string): Promise<string> {
    const vaultDir = process.env.GEMINI_WORK_DIR;

    // Resolve target directory
    let saveDir: string;
    if (targetDir && existsSync(targetDir)) {
        saveDir = targetDir;
    } else if (targetDir && vaultDir) {
        saveDir = join(vaultDir, targetDir);
    } else if (vaultDir) {
        saveDir = join(vaultDir, '00_收集');
    } else {
        throw new Error('GEMINI_WORK_DIR not set and no absolute targetDir provided');
    }

    await mkdir(saveDir, { recursive: true });

    const { title, content } = await fetchMarkdown(url);
    const safeTitle = sanitizeFilename(title);
    const today = new Date().toISOString().split('T')[0];

    const markdown = `---
title: ${title}
url: ${url}
date: ${today}
type: clipper
tags: [inbox]
---

${content}`;

    // Avoid overwriting existing files
    let filePath = join(saveDir, `${safeTitle}.md`);
    let counter = 1;
    while (existsSync(filePath)) {
        filePath = join(saveDir, `${safeTitle}_${counter++}.md`);
    }

    await writeFile(filePath, markdown, 'utf-8');
    return filePath;
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const url = process.argv[2];
    if (!url) { console.error('Usage: tsx clipper.ts <url> [target_dir]'); process.exit(1); }
    console.log(`✂️  Clipping: ${url}`);
    const path = await clipUrl(url, process.argv[3]);
    console.log(`✅ Saved to: ${path}`);
}
