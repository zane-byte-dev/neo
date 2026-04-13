#!/usr/bin/env node
/**
 * notebook — 文件系统知识库 CRUD 操作
 * 操作 {workDir}/notebooks/ 目录下的 Markdown 文件
 * stdin: JSON { args, context: { workDir } }
 * stdout: JSON { type: 'text'|'error', content: '...' }
 */
const fs = require('fs');
const path = require('path');

// ── Frontmatter helpers ───────────────────────────────────────────────────

function parseFrontmatter(text) {
    const meta = {};
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

function serializeFrontmatter(meta, body) {
    const lines = ['---'];
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

function titleFromFilename(filename) {
    return filename.replace(/\.md$/, '').replace(/^\d+_/, '').replace(/_/g, ' ').trim();
}

// ── File system helpers ───────────────────────────────────────────────────

function listMdFilesRecursive(dir, relBase) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.tmp' || entry.name.endsWith('.tmp')) continue;
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...listMdFilesRecursive(path.join(dir, entry.name), relPath));
        } else if (entry.name.endsWith('.md')) {
            results.push(relPath);
        }
    }
    return results.sort();
}

function parseEntry(nbDir, relPath, includeContent) {
    const filePath = path.join(nbDir, relPath);
    const raw = fs.readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const parts    = relPath.split('/');
    const filename = parts[parts.length - 1];
    const notebook = parts.length > 1 ? parts[0] : '.';
    const title    = meta.title || titleFromFilename(filename);
    const tags     = meta.tags?.length ? JSON.stringify(meta.tags) : null;
    const entry = {
        id: relPath, notebook, filename, title,
        author: meta.author || null, date: meta.date || null,
        source: meta.source || null, summary: meta.summary || null, tags,
    };
    if (includeContent) entry.content = body;
    return entry;
}

function formatTags(raw) {
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return [raw]; }
}

function formatMeta(r) {
    const parts = [];
    if (r.date)   parts.push(`📅 ${r.date}`);
    if (r.author) parts.push(`✍️ ${r.author}`);
    if (r.source) parts.push(`📌 ${r.source}`);
    const tags = formatTags(r.tags);
    if (tags.length) parts.push(`🏷️ ${tags.join(', ')}`);
    return parts.join('  ');
}

// ── Notebook operations ───────────────────────────────────────────────────

function nbListNotebooks(nbDir) {
    if (!fs.existsSync(nbDir)) return [];
    return fs.readdirSync(nbDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '.tmp' && !d.name.endsWith('.tmp') && !d.name.startsWith('.'))
        .map(d => d.name).sort();
}

function nbList(nbDir, opts) {
    if (!fs.existsSync(nbDir)) return [];
    const baseDir = opts?.notebook ? path.join(nbDir, opts.notebook) : nbDir;
    const baseRel = opts?.notebook ?? '';
    const relPaths = listMdFilesRecursive(baseDir, baseRel);
    const limit = Math.min(opts?.limit ?? 300, 500);
    const entries = [];
    for (const relPath of relPaths) {
        if (entries.length >= limit) break;
        try { entries.push(parseEntry(nbDir, relPath, false)); } catch { /* skip */ }
    }
    return entries;
}

function nbSearch(nbDir, query, opts) {
    const all = nbList(nbDir, { notebook: opts?.notebook, limit: 500 });
    const q = query.toLowerCase();
    const limit = Math.min(opts?.limit ?? 20, 100);
    const results = [];
    for (const entry of all) {
        const inTitle   = entry.title.toLowerCase().includes(q);
        const inSummary = entry.summary?.toLowerCase().includes(q) ?? false;
        if (inTitle || inSummary) {
            results.push({ ...entry });
        } else {
            try {
                const full = parseEntry(nbDir, entry.id, true);
                const body = (full.content ?? '').toLowerCase();
                const idx  = body.indexOf(q);
                if (idx === -1) continue;
                const snippet = '…' + full.content.slice(Math.max(0, idx - 60), idx + 120).trim() + '…';
                results.push({ ...entry, snippet });
            } catch { continue; }
        }
        if (results.length >= limit) break;
    }
    return results;
}

function nbGet(nbDir, id) {
    const filePath = path.join(nbDir, id);
    if (!path.resolve(filePath).startsWith(path.resolve(nbDir) + '/')) return undefined;
    if (!fs.existsSync(filePath)) return undefined;
    try { return parseEntry(nbDir, id, true); } catch { return undefined; }
}

function nbGetByTitle(nbDir, titleQuery, notebook) {
    const entries = nbList(nbDir, { notebook });
    const q = titleQuery.toLowerCase();
    const match = entries.find(e => e.title.toLowerCase().includes(q));
    if (!match) return undefined;
    return nbGet(nbDir, match.id);
}

function nbCreate(nbDir, notebook, data) {
    const dir = path.join(nbDir, notebook);
    fs.mkdirSync(dir, { recursive: true });
    const slug = data.title.trim().replace(/[<>:"/\\|?*\n]/g, '').replace(/\s+/g, '_').slice(0, 60);
    const dateStr = (data.date ?? new Date().toISOString().split('T')[0]).replace(/-/g, '');
    const filename = `${slug}_${dateStr}.md`;
    const filePath = path.join(dir, filename);
    const tagsArr = data.tags ? (typeof data.tags === 'string' ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : data.tags) : [];
    const meta = {
        title: data.title.trim(),
        date: data.date || new Date().toISOString().split('T')[0],
        author: data.author || undefined, source: data.source || undefined,
        summary: data.summary || undefined, tags: tagsArr.length ? tagsArr : undefined,
    };
    fs.writeFileSync(filePath, serializeFrontmatter(meta, data.content ?? ''), 'utf8');
    return {
        id: `${notebook}/${filename}`, notebook, filename,
        title: meta.title, author: meta.author || null, date: meta.date || null,
        source: meta.source || null, summary: meta.summary || null,
        tags: tagsArr.length ? JSON.stringify(tagsArr) : null, content: data.content ?? '',
    };
}

function nbUpdate(nbDir, id, data) {
    const existing = nbGet(nbDir, id);
    if (!existing) return undefined;
    const filePath = path.join(nbDir, id);
    const existTags = existing.tags ? JSON.parse(existing.tags) : [];
    const newTagsRaw = data.tags !== undefined ? data.tags : existing.tags;
    let newTags;
    if (newTagsRaw && typeof newTagsRaw === 'string') {
        try { newTags = JSON.parse(newTagsRaw); } catch { newTags = newTagsRaw.split(',').map(t => t.trim()).filter(Boolean); }
    } else { newTags = existTags; }
    const meta = {
        title:   data.title   !== undefined ? data.title   : existing.title,
        date:    data.date    !== undefined ? (data.date    || undefined) : (existing.date    || undefined),
        author:  data.author  !== undefined ? (data.author  || undefined) : (existing.author  || undefined),
        source:  data.source  !== undefined ? (data.source  || undefined) : (existing.source  || undefined),
        summary: data.summary !== undefined ? (data.summary || undefined) : (existing.summary || undefined),
        tags:    newTags.length ? newTags : undefined,
    };
    const body = data.content !== undefined ? (data.content ?? '') : (existing.content ?? '');
    fs.writeFileSync(filePath, serializeFrontmatter(meta, body), 'utf8');
    return {
        ...existing, title: meta.title, author: meta.author || null, date: meta.date || null,
        source: meta.source || null, summary: meta.summary || null,
        tags: newTags.length ? JSON.stringify(newTags) : null, content: body,
    };
}

function nbDelete(nbDir, id) {
    const filePath = path.join(nbDir, id);
    if (!path.resolve(filePath).startsWith(path.resolve(nbDir) + '/')) return false;
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
}

// ── Main handler ──────────────────────────────────────────────────────────

async function main() {
    const raw = await new Promise((resolve) => {
        let data = '';
        process.stdin.on('data', (chunk) => (data += chunk));
        process.stdin.on('end', () => resolve(data));
    });

    const { args, context } = JSON.parse(raw);
    const action = String(args.action ?? '').trim();
    const nbDir = path.join(context.workDir, 'notebooks');

    const ok = (content) => console.log(JSON.stringify({ type: 'text', content }));
    const err = (content) => console.log(JSON.stringify({ type: 'error', content }));

    // ── NOTEBOOKS
    if (action === 'notebooks') {
        const nbs = nbListNotebooks(nbDir);
        if (nbs.length === 0) return ok('没有找到任何 notebook（notebooks/ 目录为空或不存在）');
        return ok(`共 ${nbs.length} 个 notebook：\n${nbs.map(n => `• ${n}`).join('\n')}`);
    }

    // ── LIST
    if (action === 'list') {
        const limit = Number(args.limit ?? 50);
        const nb = args.notebook ? String(args.notebook) : undefined;
        const rows = nbList(nbDir, { notebook: nb, limit });
        if (rows.length === 0) return ok(nb ? `notebook "${nb}" 暂无条目` : '没有找到任何条目');
        const prefix = nb ? `notebook「${nb}」` : '全部 notebook';
        const lines = rows.map(r => {
            const meta = formatMeta(r);
            const summary = r.summary ? `\n  ${r.summary}` : '';
            return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${summary}`;
        });
        return ok(`${prefix}共 ${rows.length} 条：\n\n` + lines.join('\n\n'));
    }

    // ── SEARCH
    if (action === 'search') {
        const query = String(args.query ?? '').trim();
        if (!query) return err('search 需要提供 query 参数');
        const nb = args.notebook ? String(args.notebook) : undefined;
        const rows = nbSearch(nbDir, query, { notebook: nb, limit: Number(args.limit ?? 20) });
        if (rows.length === 0) return ok(`未找到包含「${query}」的条目。`);
        const lines = rows.map(r => {
            const meta = formatMeta(r);
            const snip = r.snippet ? `\n  > ${r.snippet}` : '';
            return `[${r.id}] **${r.title}**${meta ? `  ${meta}` : ''}${snip}`;
        });
        return ok(`搜索「${query}」共 ${rows.length} 条：\n\n` + lines.join('\n\n'));
    }

    // ── READ
    if (action === 'read') {
        let row;
        if (args.id != null) {
            row = nbGet(nbDir, String(args.id));
        } else if (args.title_query) {
            const nb = args.notebook ? String(args.notebook) : undefined;
            row = nbGetByTitle(nbDir, String(args.title_query), nb);
        } else {
            return err('read 需要提供 id 或 title_query');
        }
        if (!row) return err('未找到对应条目');
        const meta = formatMeta(row);
        const tags = formatTags(row.tags);
        const header = [
            `# ${row.title}`, meta,
            row.summary ? `\n**摘要：** ${row.summary}` : '',
            tags.length ? `**标签：** ${tags.join(', ')}` : '',
            `\n---\n`,
        ].filter(Boolean).join('\n');
        return ok(header + (row.content ?? '（无正文）'));
    }

    // ── ADD
    if (action === 'add') {
        const title = String(args.title ?? '').trim();
        if (!title) return err('add 需要提供 title');
        const nb = String(args.notebook ?? 'personal');
        const entry = nbCreate(nbDir, nb, {
            title, author: args.author || null, date: args.date || null,
            source: args.source || null, summary: args.summary || null,
            tags: args.tags || null, content: args.content || null,
        });
        return ok(`✅ 笔记已添加到 "${nb}"\nID: ${entry.id}\n标题: ${entry.title}`);
    }

    // ── UPDATE
    if (action === 'update') {
        if (args.id == null) return err('update 需要提供 id');
        const updated = nbUpdate(nbDir, String(args.id), {
            title: args.title, author: args.author, date: args.date,
            source: args.source, summary: args.summary, tags: args.tags,
            content: args.content !== undefined ? String(args.content) : undefined,
        });
        if (!updated) return err(`未找到 id="${args.id}" 的条目`);
        return ok(`✅ 笔记已更新：${updated.title}`);
    }

    // ── DELETE
    if (action === 'delete') {
        if (args.id == null) return err('delete 需要提供 id');
        const id = String(args.id);
        const existing = nbGet(nbDir, id);
        if (!existing) return err(`未找到 id="${id}" 的条目`);
        nbDelete(nbDir, id);
        return ok(`✅ 笔记「${existing.title}」已删除`);
    }

    return err(`未知 action: "${action}"`);
}

main();
