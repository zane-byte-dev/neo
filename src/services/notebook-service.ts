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
import { parseJsonLines, readJsonFileSyncOr } from '../utils/json.js';

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

export interface FrontmatterMeta {
    title?: string;
    date?: string;
    author?: string;
    source?: string;
    summary?: string;
    tags?: string[];
    archived?: boolean;
}

export function parseFrontmatter(text: string): { meta: FrontmatterMeta; body: string } {
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
                    case 'archived': meta.archived = val === 'true'; break;
                }
            }
        }
    }

    return { meta, body };
}

export function serializeFrontmatter(meta: FrontmatterMeta, body: string): string {
    const lines: string[] = ['---'];
    if (meta.title)   lines.push(`title: ${meta.title}`);
    if (meta.date)    lines.push(`date: ${meta.date}`);
    if (meta.author)  lines.push(`author: ${meta.author}`);
    if (meta.source)  lines.push(`source: ${meta.source}`);
    if (meta.summary) lines.push(`summary: ${meta.summary}`);
    if (meta.tags?.length) lines.push(`tags: [${meta.tags.join(', ')}]`);
    if (meta.archived) lines.push(`archived: true`);
    lines.push('---\n');
    lines.push(body);
    return lines.join('\n');
}

export function titleFromFilename(filename: string): string {
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
    // relPath = "notebooks/{nbName}/file.md" → notebook = parts[1]
    // Fallback for legacy paths without "notebooks/" prefix: notebook = parts[0]
    const notebook = parts[0] === 'notebooks' && parts.length >= 3 ? parts[1] : (parts.length > 1 ? parts[0] : '.');
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
    const dir = notebooksDir(workDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '.tmp' && !d.name.endsWith('.tmp') && !d.name.startsWith('.'))
        .map(d => d.name)
        .sort();
}

export function nbList(workDir: string, opts?: { notebook?: string; limit?: number }): NotebookEntryPartial[] {
    const nbRoot = notebooksDir(workDir);
    if (!existsSync(nbRoot)) return [];

    const baseDir = opts?.notebook ? join(nbRoot, opts.notebook) : nbRoot;
    const baseRel = opts?.notebook ? `notebooks/${opts.notebook}` : 'notebooks';
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
    if (!safeWithin(workDir, filePath)) return undefined;
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
    if (!safeWithin(workDir, filePath)) return false;
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
}

// ── NotebookLM-style extensions ──────────────────────────────────────────────
//
// The functions below add source/note/artifact/config/chat primitives layered
// on top of the existing per-notebook directory: `{workDir}/notebooks/{name}/`.
// Sub-resources are stored under .neo/notebooks/{name}/ so they don't mix
// with the user's own article .md files:
//
//   .neo/notebooks/{name}/meta/config.json               — notebook settings
//   .neo/notebooks/{name}/meta/source-guides/{id}.json   — AI-generated summary
//   .neo/notebooks/{name}/notes/{noteId}.md              — user/AI notes
//   .neo/notebooks/{name}/artifacts/{artifactId}.json    — generated artifacts
//   .neo/notebooks/{name}/chat/history.jsonl             — notebook-scoped chat
//
// User article .md files remain at notebooks/{name}/*.md (unchanged).
//
// `sourceId` = filename without the `.md` extension (human-readable, stable).

/** System metadata directory for a notebook (inside .neo/). */
function notebookBaseDir(workDir: string, notebook: string): string {
    return join(workDir, '.neo', 'notebooks', notebook);
}

function notebookMetaDir(workDir: string, notebook: string): string {
    return join(notebookBaseDir(workDir, notebook), 'meta');
}

function sourceGuideDir(workDir: string, notebook: string): string {
    return join(notebookMetaDir(workDir, notebook), 'source-guides');
}

function sourceGuideFilePath(workDir: string, notebook: string, sourceId: string): string {
    return join(sourceGuideDir(workDir, notebook), `${safeFilename(sourceId)}.json`);
}

function notebookConfigFilePath(workDir: string, notebook: string): string {
    return join(notebookMetaDir(workDir, notebook), 'config.json');
}

function notebookNotesDir(workDir: string, notebook: string): string {
    return join(notebookBaseDir(workDir, notebook), 'notes');
}

function notebookNoteFilePath(workDir: string, notebook: string, noteId: string): string {
    return join(notebookNotesDir(workDir, notebook), `${safeFilename(noteId)}.md`);
}

function notebookArtifactsDir(workDir: string, notebook: string): string {
    return join(notebookBaseDir(workDir, notebook), 'artifacts');
}

function notebookArtifactFilePath(workDir: string, notebook: string, artifactId: string): string {
    return join(notebookArtifactsDir(workDir, notebook), `${safeFilename(artifactId)}.json`);
}

function notebookChatDir(workDir: string, notebook: string): string {
    return join(notebookBaseDir(workDir, notebook), 'chat');
}

/** Content directory for a notebook (where user .md files live). */
function notebookContentDir(workDir: string, notebook: string): string {
    return join(workDir, 'notebooks', notebook);
}

/** Derive a stable sourceId from an entry ID ("notebooks/xx/foo.md" → "foo"). */
export function sourceIdFromEntryId(id: string): string {
    const parts = id.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
}

function sourceEntryId(notebook: string, sourceId: string): string {
    return `notebooks/${notebook}/${sourceId}.md`;
}

function ensureDir(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function safeWithin(baseDir: string, target: string): boolean {
    return resolve(target).startsWith(resolve(baseDir) + '/');
}

function safeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*\n\r]/g, '').replace(/\s+/g, '_').slice(0, 100);
}

function inferSourceType(source: string | null | undefined): SourceMeta['type'] {
    const src = source || '';
    if (/youtube\.com|youtu\.be/i.test(src)) return 'youtube';
    if (src.startsWith('http')) return 'url';
    if (/\.pdf$/i.test(src)) return 'pdf';
    return 'text';
}

// ── Notebook directory listing (proper) ──────────────────────────────────────

/** List proper notebook names under `{workDir}/notebooks/` (excludes dotfiles). */
export function nbListNotebooksProper(workDir: string): string[] {
    const dir = join(workDir, 'notebooks');
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.endsWith('.tmp'))
        .map(d => d.name)
        .sort();
}

// ── Source management ────────────────────────────────────────────────────────

export interface SourceMeta {
    id: string;           // sourceId (filename without .md)
    notebook: string;
    entryId: string;      // full entry id "notebooks/{nb}/{filename}"
    title: string;
    source: string | null;   // original URL or null
    date: string | null;
    summary: string | null;
    tags: string | null;
    type: 'text' | 'url' | 'youtube' | 'pdf' | 'audio' | 'image';
    hasGuide: boolean;    // whether source-guide has been generated
}

export interface SourceImportInput {
    title: string;
    content: string;
    source?: string | null;    // original URL
    type?: SourceMeta['type'];
    date?: string | null;
    summary?: string | null;
    tags?: string[] | null;
}

/** List all sources in a notebook with guide-availability flag. */
export function nbListSources(workDir: string, notebook: string): SourceMeta[] {
    const contentDir = notebookContentDir(workDir, notebook);
    if (!existsSync(contentDir)) return [];

    const files = readdirSync(contentDir, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.md'))
        .map(d => d.name)
        .sort();

    const guideDir = sourceGuideDir(workDir, notebook);
    const existingGuides = existsSync(guideDir)
        ? new Set(readdirSync(guideDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')))
        : new Set<string>();

    const results: SourceMeta[] = [];
    for (const filename of files) {
        try {
            const raw = readFileSync(join(contentDir, filename), 'utf8');
            const { meta } = parseFrontmatter(raw);
            if (meta.archived) continue;  // soft-deleted
            const sourceId = filename.replace(/\.md$/, '');
            const title = meta.title || titleFromFilename(filename);

            results.push({
                id: sourceId,
                notebook,
                entryId: `notebooks/${notebook}/${filename}`,
                title,
                source: meta.source || null,
                date: meta.date || null,
                summary: meta.summary || null,
                tags: meta.tags?.length ? JSON.stringify(meta.tags) : null,
                type: inferSourceType(meta.source),
                hasGuide: existingGuides.has(sourceId),
            });
        } catch { /* skip */ }
    }
    return results;
}

/** Import a new source from extracted text content. */
export function nbImportSource(workDir: string, notebook: string, data: SourceImportInput): SourceMeta {
    const created = nbCreate(workDir, notebook, {
        title: data.title,
        content: data.content,
        source: data.source ?? null,
        date: data.date ?? null,
        summary: data.summary ?? null,
        tags: data.tags?.length ? JSON.stringify(data.tags) : null,
    });

    const sourceId = sourceIdFromEntryId(created.id);
    return {
        id: sourceId,
        notebook,
        entryId: created.id,
        title: created.title,
        source: created.source,
        date: created.date,
        summary: created.summary,
        tags: created.tags,
        type: data.type ?? 'text',
        hasGuide: false,
    };
}

/** Resolve a sourceId back to an entry within a notebook. */
export function nbGetSourceEntry(workDir: string, notebook: string, sourceId: string): NotebookEntry | undefined {
    const entryId = `notebooks/${notebook}/${sourceId}.md`;
    return nbGet(workDir, entryId);
}

/** Soft-delete a source by setting `archived: true` in frontmatter. */
export function nbArchiveSource(workDir: string, notebook: string, sourceId: string): boolean {
    const entryId = `notebooks/${notebook}/${sourceId}.md`;
    const filePath = join(workDir, entryId);
    if (!resolve(filePath).startsWith(resolve(workDir) + '/')) return false;
    if (!existsSync(filePath)) return false;

    const raw = readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    meta.archived = true;
    writeFileSync(filePath, serializeFrontmatter(meta, body), 'utf8');
    return true;
}

/** Rename a source (update title in frontmatter, file stays the same). */
export function nbRenameSource(workDir: string, notebook: string, sourceId: string, newTitle: string): SourceMeta | undefined {
    const entryId = `notebooks/${notebook}/${sourceId}.md`;
    const updated = nbUpdate(workDir, entryId, { title: newTitle });
    if (!updated) return undefined;

    const hasGuide = existsSync(sourceGuideFilePath(workDir, notebook, sourceId));

    return {
        id: sourceId,
        notebook,
        entryId,
        title: updated.title,
        source: updated.source,
        date: updated.date,
        summary: updated.summary,
        tags: updated.tags,
        type: inferSourceType(updated.source),
        hasGuide,
    };
}

// ── Source guide (AI summary + topics + questions) ───────────────────────────

export interface SourceGuide {
    sourceId: string;
    summary: string;
    keyTopics: string[];
    suggestedQuestions: string[];
    generatedAt: number;
}

export function nbGetSourceGuide(workDir: string, notebook: string, sourceId: string): SourceGuide | undefined {
    const file = sourceGuideFilePath(workDir, notebook, sourceId);
    if (!existsSync(file)) return undefined;
    return readJsonFileSyncOr<SourceGuide | undefined>(file, undefined);
}

/** List all sources along with their guides in one pass — avoids N+1 requests. */
export function nbListSourcesWithGuides(workDir: string, notebook: string): (SourceMeta & { guide: SourceGuide | null })[] {
    const sources = nbListSources(workDir, notebook);
    return sources.map((s) => {
        const file = sourceGuideFilePath(workDir, notebook, s.id);
        const guide = existsSync(file)
            ? readJsonFileSyncOr<SourceGuide | null>(file, null)
            : null;
        return { ...s, guide };
    });
}

export function nbSaveSourceGuide(workDir: string, notebook: string, guide: SourceGuide): void {
    const dir = sourceGuideDir(workDir, notebook);
    ensureDir(dir);
    const file = sourceGuideFilePath(workDir, notebook, guide.sourceId);
    writeFileSync(file, JSON.stringify(guide, null, 2), 'utf8');
}

// ── Notebook config ──────────────────────────────────────────────────────────

export interface NotebookConfig {
    emoji?: string;
    description?: string;
    chatStyle?: 'default' | 'study-guide' | 'custom';
    customStyle?: string;
    answerLength?: 'short' | 'default' | 'long';
    citationMode?: 'strict' | 'mixed';
    overview?: string;         // cached notebook-level overview
}

export function nbGetConfig(workDir: string, notebook: string): NotebookConfig {
    const file = notebookConfigFilePath(workDir, notebook);
    if (!existsSync(file)) return {};
    return readJsonFileSyncOr<NotebookConfig>(file, {});
}

export function nbSetConfig(workDir: string, notebook: string, config: NotebookConfig): void {
    const dir = notebookMetaDir(workDir, notebook);
    ensureDir(dir);
    writeFileSync(notebookConfigFilePath(workDir, notebook), JSON.stringify(config, null, 2), 'utf8');
}

// ── Notes ────────────────────────────────────────────────────────────────────

export interface NotebookNote {
    id: string;
    notebook: string;
    title: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    source: 'user' | 'ai-chat' | 'ai-quick-action';
}

export function nbListNotes(workDir: string, notebook: string): NotebookNote[] {
    const dir = notebookNotesDir(workDir, notebook);
    if (!existsSync(dir)) return [];
    const results: NotebookNote[] = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
        try {
            const raw = readFileSync(join(dir, f), 'utf8');
            const { meta, body } = parseFrontmatter(raw);
            // Custom meta: title, createdAt, updatedAt, source (kept as tags[0] if present)
            const id = f.replace(/\.md$/, '');
            const createdAt = Number(meta.date) || 0;
            results.push({
                id,
                notebook,
                title: meta.title || titleFromFilename(f),
                content: body,
                createdAt,
                updatedAt: createdAt,
                source: (meta.author as NotebookNote['source']) || 'user',
            });
        } catch { /* skip */ }
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
}

export interface NoteSaveInput {
    id?: string;
    title: string;
    content: string;
    source?: NotebookNote['source'];
}

export function nbSaveNote(workDir: string, notebook: string, data: NoteSaveInput): NotebookNote {
    const dir = notebookNotesDir(workDir, notebook);
    ensureDir(dir);
    const now = Date.now();
    const id = data.id || `note_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const source = data.source || 'user';
    const meta: FrontmatterMeta = {
        title: data.title,
        date: String(now),
        author: source,   // reuse author field to tag source
    };
    writeFileSync(notebookNoteFilePath(workDir, notebook, id), serializeFrontmatter(meta, data.content), 'utf8');
    return {
        id,
        notebook,
        title: data.title,
        content: data.content,
        createdAt: now,
        updatedAt: now,
        source,
    };
}

export function nbDeleteNote(workDir: string, notebook: string, noteId: string): boolean {
    const dir = notebookNotesDir(workDir, notebook);
    const file = notebookNoteFilePath(workDir, notebook, noteId);
    if (!safeWithin(dir, file)) return false;
    if (!existsSync(file)) return false;
    unlinkSync(file);
    return true;
}

/** Promote a note into a full source document. */
export function nbConvertNoteToSource(workDir: string, notebook: string, noteId: string): SourceMeta | undefined {
    const notes = nbListNotes(workDir, notebook);
    const note = notes.find(n => n.id === noteId);
    if (!note) return undefined;
    const imported = nbImportSource(workDir, notebook, {
        title: note.title,
        content: note.content,
        summary: note.content.slice(0, 120).replace(/\n+/g, ' ').trim(),
        type: 'text',
    });
    nbDeleteNote(workDir, notebook, noteId);
    return imported;
}

// ── Artifacts (mindmap / report / audio script / etc.) ───────────────────────

export type ArtifactType = 'mindmap' | 'report' | 'audio' | 'flashcards' | 'custom';

export interface Artifact {
    id: string;
    notebook: string;
    type: ArtifactType;
    subtype?: string;         // e.g. report subtype: 'faq' | 'study-guide' | 'briefing'
    title: string;
    data: unknown;            // type-specific payload
    createdAt: number;
}

export function nbListArtifacts(workDir: string, notebook: string, type?: ArtifactType): Artifact[] {
    const dir = notebookArtifactsDir(workDir, notebook);
    if (!existsSync(dir)) return [];
    const results: Artifact[] = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
        const artifact = readJsonFileSyncOr<Artifact | null>(join(dir, f), null);
        if (artifact && (!type || artifact.type === type)) results.push(artifact);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
}

export function nbGetArtifact(workDir: string, notebook: string, id: string): Artifact | undefined {
    const file = notebookArtifactFilePath(workDir, notebook, id);
    if (!existsSync(file)) return undefined;
    return readJsonFileSyncOr<Artifact | undefined>(file, undefined);
}

export interface ArtifactSaveInput {
    id?: string;
    type: ArtifactType;
    subtype?: string;
    title: string;
    data: unknown;
}

export function nbSaveArtifact(workDir: string, notebook: string, input: ArtifactSaveInput): Artifact {
    const dir = notebookArtifactsDir(workDir, notebook);
    ensureDir(dir);
    const now = Date.now();
    const id = input.id || `${input.type}_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const artifact: Artifact = {
        id,
        notebook,
        type: input.type,
        subtype: input.subtype,
        title: input.title,
        data: input.data,
        createdAt: now,
    };
    writeFileSync(notebookArtifactFilePath(workDir, notebook, id), JSON.stringify(artifact, null, 2), 'utf8');
    return artifact;
}

export function nbDeleteArtifact(workDir: string, notebook: string, id: string): boolean {
    const file = notebookArtifactFilePath(workDir, notebook, id);
    if (!existsSync(file)) return false;
    unlinkSync(file);
    return true;
}

// ── Notebook chat history ────────────────────────────────────────────────────

export interface NotebookChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    citations?: Array<{ n: number; sourceId: string; title: string; snippet?: string }>;
    selectedSources?: string[];   // snapshot of sourceIds active at send time
    timestamp: number;
}

function chatFilePath(workDir: string, notebook: string): string {
    return join(notebookChatDir(workDir, notebook), 'history.jsonl');
}

export function nbReadChatHistory(workDir: string, notebook: string): NotebookChatMessage[] {
    const file = chatFilePath(workDir, notebook);
    if (!existsSync(file)) return [];
    return parseJsonLines<NotebookChatMessage>(readFileSync(file, 'utf8'));
}

export function nbAppendChatMessage(workDir: string, notebook: string, msg: NotebookChatMessage): void {
    const dir = notebookChatDir(workDir, notebook);
    ensureDir(dir);
    const file = join(dir, 'history.jsonl');
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const line = JSON.stringify(msg);
    writeFileSync(file, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + line + '\n', 'utf8');
}

export function nbClearChatHistory(workDir: string, notebook: string): void {
    const file = chatFilePath(workDir, notebook);
    if (existsSync(file)) unlinkSync(file);
}

/**
 * Fork conversation: keep only messages up to (and including) the given messageId,
 * discard everything after it.
 */
export function nbForkChatHistory(workDir: string, notebook: string, messageId: string): NotebookChatMessage[] {
    const all = nbReadChatHistory(workDir, notebook);
    const idx = all.findIndex(m => m.id === messageId);
    if (idx === -1) return all; // message not found, no-op
    const kept = all.slice(0, idx + 1);
    // Rewrite the file with only the kept messages
    const dir = notebookChatDir(workDir, notebook);
    ensureDir(dir);
    const file = join(dir, 'history.jsonl');
    writeFileSync(file, kept.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf8');
    return kept;
}

