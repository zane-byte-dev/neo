/**
 * 🎧 Audio Refinery — Convert Markdown files to MP3 via Edge TTS
 * Replaces tools/audio_refinery/script.py
 *
 * Usage (direct): tsx src/lib/tools/audio-refinery.ts <file_or_dir> [voice]
 */

import { readFile, writeFile, mkdir, stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { EdgeTTS } from '@travisvn/edge-tts';

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const CONCURRENCY = 3;

function cleanMarkdown(text: string): string {
    return text
        .replace(/^---[\s\S]*?---/m, '')           // YAML frontmatter
        .replace(/```[\s\S]*?```/g, '')             // code blocks
        .replace(/`[^`]*`/g, '')                    // inline code
        .replace(/^#{1,6}\s/gm, '')                 // headings
        .replace(/\*\*|__|[*_]/g, '')               // bold / italic
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')     // images
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // links → text
        .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1') // WikiLinks
        .replace(/!\[\[.*?\]\]/g, '')               // Obsidian embeds
        .replace(/<[^>]+>/g, '')                    // HTML tags
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function processFile(filePath: string, voice: string): Promise<string> {
    const dir = dirname(filePath);
    const name = basename(filePath, extname(filePath));
    const audioDir = join(dir, 'Audio');
    const outputPath = join(audioDir, `${name}.mp3`);

    await mkdir(audioDir, { recursive: true });

    // Incremental: skip if mp3 is newer than md
    if (existsSync(outputPath)) {
        const [mdStat, mp3Stat] = await Promise.all([stat(filePath), stat(outputPath)]);
        if (mdStat.mtimeMs < mp3Stat.mtimeMs) {
            return `⏩ Skipped (up to date): ${basename(filePath)}`;
        }
    }

    const raw = await readFile(filePath, 'utf-8');
    const cleanText = cleanMarkdown(raw);
    if (!cleanText) return `⚠️ Skipped (empty): ${basename(filePath)}`;

    const tts = new EdgeTTS(cleanText, voice);
    const { audio } = await tts.synthesize();
    const buf = Buffer.from(await audio.arrayBuffer());
    await writeFile(outputPath, buf);

    // Back-fill embed link into Markdown
    const embedString = `![[Audio/${name}.mp3]]`;
    if (!raw.includes(embedString)) {
        const yamlMatch = raw.match(/^---[\s\S]*?---\n/m);
        const newContent = yamlMatch
            ? raw.slice(0, yamlMatch[0].length) + `\n${embedString}\n` + raw.slice(yamlMatch[0].length)
            : `${embedString}\n\n${raw}`;
        await writeFile(filePath, newContent, 'utf-8');
    }

    return `✅ Generated: ${basename(outputPath)}`;
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = [];
    const queue = [...tasks];
    const workers = Array(Math.min(limit, tasks.length)).fill(null).map(async () => {
        while (queue.length > 0) {
            const task = queue.shift()!;
            results.push(await task());
        }
    });
    await Promise.all(workers);
    return results;
}

export async function audioRefinery(target: string, voice = DEFAULT_VOICE): Promise<string> {
    const files: string[] = [];

    const s = await stat(target).catch(() => null);
    if (!s) throw new Error(`Path not found: ${target}`);

    if (s.isFile() && (target.endsWith('.md') || target.endsWith('.txt'))) {
        files.push(target);
    } else if (s.isDirectory()) {
        const walk = async (dir: string) => {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const e of entries) {
                const full = join(dir, e.name);
                if (e.isDirectory() && e.name !== 'Audio') await walk(full);
                else if (e.isFile() && e.name.endsWith('.md')) files.push(full);
            }
        };
        await walk(target);
    }

    if (files.length === 0) return '⚠️ No Markdown files found.';

    const tasks = files.map(f => () => processFile(f, voice));
    const results = await runWithConcurrency(tasks, CONCURRENCY);

    return results.join('\n');
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const target = process.argv[2];
    if (!target) { console.error('Usage: tsx audio-refinery.ts <file_or_dir> [voice]'); process.exit(1); }
    console.log(`🎧 Audio Refinery starting...`);
    const output = await audioRefinery(target, process.argv[3]);
    console.log(output);
}
