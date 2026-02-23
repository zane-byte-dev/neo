/**
 * ✂️ Clipper — Fetch a webpage and save it as Markdown to vault
 *
 * Fetch strategy:
 *   1. Jina AI (r.jina.ai) — fast, handles most pages
 *   2. Local readability fallback via fetch + @mozilla/readability — works offline
 *
 * Usage (direct): tsx src/lib/tools/clipper.ts <url> [target_dir]
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config();

function sanitizeFilename(title: string): string {
    return title.replace(/[\\/*?:<>|"]/g, '').trim().substring(0, 100);
}

/**
 * Strategy 1: Use Jina AI to convert a URL to Markdown.
 */
async function fetchViaJina(url: string): Promise<{ title: string; content: string }> {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/markdown' },
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`Jina API returned ${res.status}`);
    const content = await res.text();

    let title = 'Untitled Clipper';
    for (const line of content.split('\n').slice(0, 10)) {
        if (line.startsWith('Title: ')) { title = line.slice(7).trim(); break; }
        if (line.startsWith('# ')) { title = line.slice(2).trim(); break; }
    }

    return { title, content };
}

/**
 * Strategy 2: Local fetch + lightweight HTML-to-Markdown conversion.
 * Used when Jina is unavailable or times out.
 */
async function fetchViaLocal(url: string): Promise<{ title: string; content: string }> {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NeoAgent-Clipper/1.0)' },
        signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

    // Strip scripts, styles, nav, footer for cleaner content
    const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    // Naive HTML → Markdown conversion (handles common elements)
    const content = stripped
        .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `${'#'.repeat(+n)} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${text.replace(/<[^>]+>/g, '').trim()}](${href})`)
        .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
        .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.replace(/<[^>]+>/g, '').trim()}\n`)
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')            // strip remaining tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return { title, content };
}

/**
 * Fetch a URL as Markdown, trying Jina first then local fallback.
 */
async function fetchMarkdown(url: string): Promise<{ title: string; content: string; source: string }> {
    try {
        const result = await fetchViaJina(url);
        return { ...result, source: 'jina' };
    } catch (jinaErr) {
        console.warn(`[Clipper] ⚠️  Jina failed (${jinaErr}), trying local fallback...`);
        try {
            const result = await fetchViaLocal(url);
            return { ...result, source: 'local' };
        } catch (localErr) {
            throw new Error(`Both strategies failed.\n  Jina: ${jinaErr}\n  Local: ${localErr}`);
        }
    }
}

export async function clipUrl(url: string, targetDir?: string): Promise<string> {
    const vaultDir = process.env.GEMINI_WORK_DIR;

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

    const { title, content, source } = await fetchMarkdown(url);
    const safeTitle = sanitizeFilename(title);
    const today = new Date().toISOString().split('T')[0];

    const markdown = `---
title: ${title}
url: ${url}
date: ${today}
type: clipper
source: ${source}
tags: [inbox]
---

${content}`;

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
