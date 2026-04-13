/**
 * notebook-service.ts — File-system based notebook knowledge base.
 *
 * Each user has a notebooks/ directory under their workspace:
 *   {workDir}/notebooks/{notebookName}/{article}.md
 *
 * Files may contain optional YAML frontmatter (title, date, author, tags, summary).
 * IDs are "{notebookName}/{filename}" strings — no SQLite dependency.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NotebookEntry {
    id: string;           // "{notebook}/{filename}"
    notebook: string;
    filename: string;
    title: string;
    author: string | null;
    date: string | null;
    source: string | null;
    summary: string | null;
    tags: string | null;  // JSON-encoded string[]
    content?: string;
}

export type NotebookEntryPartial = Omit<NotebookEntry, 'content'>;

export interface NotebookSearchResult extends NotebookEntryPartial {
    snippet?: string;
}

export interface NotebookCreateInput {
    title: string;
    author?: string | null;
    date?: string | null;
    source?: string | null;
    summary?: string | null;
    tags?: string | null;   // JSON-encoded string[]
    content?: string | null;
}

export type NotebookUpdateInput = Partial<NotebookCreateInput>;

// ── Frontmatter helpers ───────────────────────────────────────────────────────

interface FrontmatterMeta {
    title?: string;
    date?: string;
    author?: string;
    source?: string;
    summary?: string;
    tags?: string[];
}

function parseFrontmatter(text: string): { meta: FrontmatterMeta; body: string } {
    const meta: FrontmatterMeta = {};
    let body = text;

    if (text.startsWith('---')) {
        const end = text.indexOf('\n---', 3);
        if (end !== -1) {
            const block = text.slice(4, end);
            body = text.slice(end + 4).trimStart();
            for (const line of block.split('\n')) {
                const colon = line.indexOf(':');
                if (colon === -1) continue;
                const key = line.slice(0, colon).trim();
                const val = line.slice(colon + 1).trim();
                switch (key) {
                    case 'title':   meta.title   = val.replace(/^["']|["']$/g, ''); break;
                    case 'date':    meta.date    = val; break;
                    case 'author':  meta.author  = val.replace(/^["']|["']$/g, ''); break;
                    case 'source':  meta.source  = val.replace(/^["']|["']$/g, ''); break;
                    case 'summary': meta.summary = val.replace(/^["']|["']$/g, ''); break;
                    case 'tags': {
                        const clean = val.replace(/^\[|\]$/g, '');
                        meta.tags = clean.split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
                        break;
                    }
                }
            }
        }
    }

    return { meta, body };
}

function serializeFrontmatter(meta: FrontmatterMeta, body: string): string {
    const lines: string[] = ['---'];
    if (meta.title)   lines.push(`title: ${meta.title}`);
    if (meta.date)    lines.push(`date: ${meta.date}`);
    if (meta.author)  lines.push(`author: ${meta.author}`);
    if (meta.source)  lines.push(`source: ${meta.source}`);
    if (meta.summary) lines.push(`summary: ${meta.summary}`);
    if (meta.tags?.length) lines.push(`tags: [${meta.tags.join(', ')}]`);
    lines.push('---\n');
    lines.push(body);
    return lines.join('\n');
}

function titleFromFilename(filename: string): string {
    return filename
        .replace(/\.md$/, '')
        .replace(/^\d+_/, '')
        .replace(/_/g, ' ')
        .trim();
}

function notebooksDir(workDir: string): string {
    return join(workDir, 'notebooks');
}

/** Recursively collect relative paths of all .md files under dir, excluding .tmp paths. */
function listMdFilesRecursive(dir: string, relBase: string): string[] {
    if (!existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.tmp' || entry.name.endsWith('.tmp')) continue;
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...listMdFilesRecursive(join(dir, entry.name), relPath));
        } else if (entry.name.endsWith('.md')) {
            results.push(relPath);
        }
    }
    return results.sort();
}

/** Parse a notebook entry given a relative path from workDir. */
function parseEntry(workDir: string, relPath: string, includeContent: boolean): NotebookEntry {
    const filePath = join(workDir, relPath);
    const raw = readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);

    const parts    = relPath.split('/');
    const filename = parts[parts.length - 1];
    const notebook = parts.length > 1 ? parts[0] : '.';
    const title    = meta.title || titleFromFilename(filename);
    const tags     = meta.tags?.length ? JSON.stringify(meta.tags) : null;

    return {
        id: relPath,
        notebook,
        filename,
        title,
        author:  meta.author  || null,
        date:    meta.date    || null,
        source:  meta.source  || null,
        summary: meta.summary || null,
        tags,
        ...(includeContent ? { content: body } : {}),
    };
}

// ── Operations ────────────────────────────────────────────────────────────────

export function nbListNotebooks(workDir: string): string[] {
    if (!existsSync(workDir)) return [];
    return readdirSync(workDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '.tmp' && !d.name.endsWith('.tmp') && !d.name.startsWith('.'))
        .map(d => d.name)
        .sort();
}

export function nbList(workDir: string, opts?: { notebook?: string; limit?: number }): NotebookEntryPartial[] {
    if (!existsSync(workDir)) return [];

    const baseDir = opts?.notebook ? join(workDir, opts.notebook) : workDir;
    const baseRel = opts?.notebook ?? '';
    const relPaths = listMdFilesRecursive(baseDir, baseRel);
    const limit    = Math.min(opts?.limit ?? 300, 500);
    const entries: NotebookEntryPartial[] = [];

    for (const relPath of relPaths) {
        if (entries.length >= limit) break;
        try { entries.push(parseEntry(workDir, relPath, false)); } catch { /* skip */ }
    }

    return entries;
}

export function nbSearch(workDir: string, query: string, opts?: { notebook?: string; limit?: number }): NotebookSearchResult[] {
    const all = nbList(workDir, { notebook: opts?.notebook, limit: 500 });
    const q = query.toLowerCase();
    const limit = Math.min(opts?.limit ?? 20, 100);
    const results: NotebookSearchResult[] = [];

    for (const entry of all) {
        const inTitle   = entry.title.toLowerCase().includes(q);
        const inSummary = entry.summary?.toLowerCase().includes(q) ?? false;

        if (inTitle || inSummary) {
            results.push({ ...entry });
        } else {
            try {
                const full = parseEntry(workDir, entry.id, true);
                const body = (full.content ?? '').toLowerCase();
                const idx  = body.indexOf(q);
                if (idx === -1) continue;
                const snippet = '…' + full.content!.slice(Math.max(0, idx - 60), idx + 120).trim() + '…';
                results.push({ ...entry, snippet });
            } catch { continue; }
        }

        if (results.length >= limit) break;
    }

    return results;
}

export function nbGet(workDir: string, id: string): NotebookEntry | undefined {
    const filePath = join(workDir, id);
    // Security: ensure path stays within workDir
    if (!resolve(filePath).startsWith(resolve(workDir) + '/')) return undefined;
    if (!existsSync(filePath)) return undefined;
    try { return parseEntry(workDir, id, true); } catch { return undefined; }
}

export function nbGetByTitle(workDir: string, titleQuery: string, notebook?: string): NotebookEntry | undefined {
    const entries = nbList(workDir, { notebook });
    const q = titleQuery.toLowerCase();
    const match = entries.find(e => e.title.toLowerCase().includes(q));
    if (!match) return undefined;
    return nbGet(workDir, match.id);
}

export function nbCreate(workDir: string, notebook: string, data: NotebookCreateInput): NotebookEntry {
    const dir = join(notebooksDir(workDir), notebook);
    mkdirSync(dir, { recursive: true });

    const slug = data.title.trim()
        .replace(/[<>:"/\\|?*\n]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 60);
    const dateStr = (data.date ?? new Date().toISOString().split('T')[0]).replace(/-/g, '');
    const filename = `${slug}_${dateStr}.md`;
    const filePath = join(dir, filename);

    const tagsArr: string[] = data.tags ? (JSON.parse(data.tags) as string[]) : [];
    const meta: FrontmatterMeta = {
        title:   data.title.trim(),
        date:    data.date || new Date().toISOString().split('T')[0],
        author:  data.author  || undefined,
        source:  data.source  || undefined,
        summary: data.summary || undefined,
        tags:    tagsArr.length ? tagsArr : undefined,
    };

    writeFileSync(filePath, serializeFrontmatter(meta, data.content ?? ''), 'utf8');

    return {
        id: `notebooks/${notebook}/${filename}`,
        notebook,
        filename,
        title:   meta.title!,
        author:  meta.author  || null,
        date:    meta.date    || null,
        source:  meta.source  || null,
        summary: meta.summary || null,
        tags:    tagsArr.length ? JSON.stringify(tagsArr) : null,
        content: data.content ?? '',
    };
}

export function nbUpdate(workDir: string, id: string, data: NotebookUpdateInput): NotebookEntry | undefined {
    const existing = nbGet(workDir, id);
    if (!existing) return undefined;

    const filePath = join(workDir, id);

    const existTags: string[] = existing.tags ? (JSON.parse(existing.tags) as string[]) : [];
    const newTagsRaw = data.tags !== undefined ? data.tags : existing.tags;
    const newTags: string[] = newTagsRaw ? (JSON.parse(newTagsRaw) as string[]) : existTags;

    const meta: FrontmatterMeta = {
        title:   data.title   !== undefined ? data.title   : existing.title,
        date:    data.date    !== undefined ? (data.date    || undefined) : (existing.date    || undefined),
        author:  data.author  !== undefined ? (data.author  || undefined) : (existing.author  || undefined),
        source:  data.source  !== undefined ? (data.source  || undefined) : (existing.source  || undefined),
        summary: data.summary !== undefined ? (data.summary || undefined) : (existing.summary || undefined),
        tags:    newTags.length ? newTags : undefined,
    };

    const body = data.content !== undefined ? (data.content ?? '') : (existing.content ?? '');
    writeFileSync(filePath, serializeFrontmatter(meta, body), 'utf8');

    return {
        ...existing,
        title:   meta.title!,
        author:  meta.author  || null,
        date:    meta.date    || null,
        source:  meta.source  || null,
        summary: meta.summary || null,
        tags:    newTags.length ? JSON.stringify(newTags) : null,
        content: body,
    };
}

export function nbDelete(workDir: string, id: string): boolean {
    const filePath = join(workDir, id);
    if (!resolve(filePath).startsWith(resolve(workDir) + '/')) return false;
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
}


