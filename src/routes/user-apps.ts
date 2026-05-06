/**
 * user-apps.ts — Serve per-user mini web apps from the state directory.
 *
 * Layout (per user):
 *   {stateDir}/apps/{appName}/index.html
 *   {stateDir}/apps/{appName}/...other static assets
 *
 * Routes:
 *   GET /api/apps             — list available apps (with optional manifest.json)
 *   GET /apps/:appName        — redirect to /apps/:appName/
 *   GET /apps/:appName/...    — serve static files under {stateDir}/apps/{appName}/
 *
 * Auth: enforced by the global _authMiddleware (session cookie). Apps are
 * isolated per user — only the calling user's stateDir apps are accessible.
 *
 * Security: path traversal is blocked by resolving and asserting the resolved
 * path stays within the user's apps directory.
 */
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep, extname, basename } from 'node:path';
import type { Context } from 'koa';
import type Router from '@koa/router';
import { calcUser } from '../services/user-service.js';
import { parseJsonOr } from '../utils/json.js';

const MIME_MAP: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm:  'text/html; charset=utf-8',
    js:   'application/javascript; charset=utf-8',
    mjs:  'application/javascript; charset=utf-8',
    css:  'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    map:  'application/json; charset=utf-8',
    svg:  'image/svg+xml',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif:  'image/gif',
    ico:  'image/x-icon',
    woff: 'font/woff',
    woff2:'font/woff2',
    ttf:  'font/ttf',
    otf:  'font/otf',
    txt:  'text/plain; charset=utf-8',
    md:   'text/markdown; charset=utf-8',
    wasm: 'application/wasm',
    mp3:  'audio/mpeg',
    mp4:  'video/mp4',
    webm: 'video/webm',
    pdf:  'application/pdf',
};

interface AppInfo {
    name: string;
    title: string;
    description: string | null;
    icon: string | null;
    hasIndex: boolean;
}

const APP_NAME_RE = /^[a-zA-Z0-9._-]+$/;

async function _appsDir(userId: string): Promise<string | null> {
    const userCtx = await calcUser(userId);
    const root = userCtx.stateDir;
    if (!root) return null;
    return join(root, 'apps');
}

function _isValidAppName(name: string): boolean {
    return APP_NAME_RE.test(name) && name !== '.' && name !== '..';
}

function _mimeFor(file: string): string {
    const ext = extname(file).slice(1).toLowerCase();
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

async function _safeJoin(rootDir: string, relPath: string): Promise<string | null> {
    // Decode + normalize. basename-style traversal protection: resolved path
    // must remain inside rootDir.
    let decoded: string;
    try {
        decoded = decodeURIComponent(relPath);
    } catch {
        return null;
    }
    const cleaned = normalize(decoded).replace(/^[/\\]+/, '');
    const full = resolve(rootDir, cleaned);
    const rel = relative(rootDir, full);
    if (rel.startsWith('..') || rel.startsWith(sep + '..') || rel === '..') return null;
    return full;
}

async function _readManifest(appDir: string): Promise<Partial<AppInfo>> {
    try {
        const raw = await readFile(join(appDir, 'manifest.json'), 'utf8');
        const m = parseJsonOr<Record<string, unknown>>(raw, {});
        return {
            title:       typeof m.title === 'string' ? m.title : undefined,
            description: typeof m.description === 'string' ? m.description : undefined,
            icon:        typeof m.icon === 'string' ? m.icon : undefined,
        };
    } catch {
        return {};
    }
}

async function _listApps(appsRoot: string): Promise<AppInfo[]> {
    let entries: string[] = [];
    try {
        entries = await readdir(appsRoot);
    } catch {
        return [];
    }

    const out: AppInfo[] = [];
    for (const name of entries) {
        if (!_isValidAppName(name)) continue;
        const dir = join(appsRoot, name);
        let isDir = false;
        try {
            isDir = (await stat(dir)).isDirectory();
        } catch {
            continue;
        }
        if (!isDir) continue;

        let hasIndex = false;
        try {
            const s = await stat(join(dir, 'index.html'));
            hasIndex = s.isFile();
        } catch { /* no index.html */ }

        const manifest = await _readManifest(dir);
        out.push({
            name,
            title:       manifest.title ?? name,
            description: manifest.description ?? null,
            icon:        manifest.icon ?? null,
            hasIndex,
        });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

async function _serveFile(ctx: Context, filePath: string): Promise<boolean> {
    let st;
    try {
        st = await stat(filePath);
    } catch {
        return false;
    }
    if (!st.isFile()) return false;

    ctx.type = _mimeFor(filePath);
    ctx.set('Cache-Control', 'private, no-cache');
    ctx.set('X-Content-Type-Options', 'nosniff');
    // Avoid embedding apps in third-party pages; same-origin is fine.
    ctx.set('X-Frame-Options', 'SAMEORIGIN');
    ctx.length = st.size;
    ctx.body = createReadStream(filePath);
    return true;
}

// ── Minimal multipart parser (for app file uploads) ────────────────────────

interface MultipartPart { filename: string; contentType: string; data: Buffer }

function _extractBoundary(ct: string): string | null {
    const m = ct.match(/boundary=("?)([^";,]+)\1/i);
    return m ? m[2] : null;
}

async function _readRawBody(req: import('http').IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) { req.destroy(); reject(new Error('Too large')); return; }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function _parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
    const sep = Buffer.from(`\r\n--${boundary}`);
    const start = Buffer.from(`--${boundary}`);
    const parts: MultipartPart[] = [];

    let offset = body.indexOf(start);
    if (offset < 0) return parts;
    offset += start.length;

    while (offset < body.length) {
        // Skip CRLF after boundary
        if (body[offset] === 0x0d && body[offset + 1] === 0x0a) offset += 2;
        else if (body[offset] === 0x2d && body[offset + 1] === 0x2d) break; // --
        else break;

        // Find end of headers (double CRLF)
        const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), offset);
        if (headerEnd < 0) break;
        const headerStr = body.subarray(offset, headerEnd).toString('utf8');
        offset = headerEnd + 4;

        // Find next boundary
        const nextBound = body.indexOf(sep, offset);
        const dataEnd = nextBound < 0 ? body.length : nextBound;

        // Parse Content-Disposition for filename
        const dispMatch = headerStr.match(/Content-Disposition:[^\r\n]*filename="?([^"\r\n]+)"?/i);
        const filename = dispMatch ? dispMatch[1] : '';
        const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
        const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';

        const data = body.subarray(offset, dataEnd);
        if (filename) parts.push({ filename, contentType, data });

        if (nextBound < 0) break;
        offset = nextBound + sep.length;
    }
    return parts;
}

export function userAppsRoute(router: Router): void {
    // List available apps for the current user
    router.get('/api/apps', async (ctx) => {
        const userId = ctx.state.userId as string;
        const appsRoot = await _appsDir(userId);
        if (!appsRoot) {
            ctx.body = { apps: [] };
            return;
        }
        const apps = await _listApps(appsRoot);
        ctx.body = { apps };
    });

    // Bare /apps/:appName → redirect to trailing-slash form so relative URLs
    // inside the app resolve correctly. Note: @koa/router uses path-to-regexp
    // in non-strict mode by default, which means '/apps/:appName' also matches
    // '/apps/:appName/'. Without this guard the redirect would target the same
    // URL and produce an infinite 301 loop. When a trailing slash is already
    // present, defer to the static-asset handler below.
    router.get('/apps/:appName', async (ctx, next) => {
        if (ctx.path.endsWith('/')) {
            await next();
            return;
        }
        const appName = ctx.params.appName ?? '';
        if (!_isValidAppName(appName)) { ctx.status = 404; return; }
        ctx.status = 301;
        ctx.redirect(`/apps/${encodeURIComponent(appName)}/`);
    });

    // Static asset under /apps/:appName/...
    // Uses a regex path so we can capture an arbitrary subpath portably across
    // path-to-regexp versions.
    router.get(/^\/apps\/([^/]+)\/(.*)$/, async (ctx) => {
        // @koa/router 15.x exposes regex capture groups via ctx.captures,
        // not ctx.params[0]/[1].
        const captures = (ctx as unknown as { captures?: string[] }).captures ?? [];
        const appName = captures[0] ?? '';
        const subPath = captures[1] ?? '';

        if (!_isValidAppName(appName)) { ctx.status = 404; return; }

        const userId = ctx.state.userId as string;
        const appsRoot = await _appsDir(userId);
        if (!appsRoot) { ctx.status = 404; return; }

        const appDir = join(appsRoot, appName);
        const wanted = subPath === '' || subPath.endsWith('/') ? `${subPath}index.html` : subPath;

        const resolved = await _safeJoin(appDir, wanted);
        if (!resolved) { ctx.status = 400; return; }

        const ok = await _serveFile(ctx, resolved);
        if (!ok) {
            // Try directory index for paths missing trailing slash but which
            // are actually directories.
            if (!subPath.endsWith('/')) {
                try {
                    const st = await stat(resolved);
                    if (st.isDirectory()) {
                        ctx.status = 301;
                        ctx.redirect(`/apps/${encodeURIComponent(appName)}/${subPath}/`);
                        return;
                    }
                } catch { /* fallthrough */ }
            }
            ctx.status = 404;
            ctx.type = 'text/plain; charset=utf-8';
            ctx.body = `App asset not found: ${appName}/${subPath}`;
        }
    });

    // Upload files to an app (creates the app dir if it doesn't exist)
    // POST /api/apps/:appName  — multipart/form-data with field name "files"
    router.post('/api/apps/:appName', async (ctx) => {
        const appName = ctx.params.appName ?? '';
        if (!_isValidAppName(appName)) { ctx.status = 400; ctx.body = { error: 'Invalid app name' }; return; }

        const userId = ctx.state.userId as string;
        const appsRoot = await _appsDir(userId);
        if (!appsRoot) { ctx.status = 500; ctx.body = { error: 'No state dir' }; return; }

        const contentType = ctx.get('content-type') ?? '';
        if (!contentType.includes('multipart/form-data')) {
            ctx.status = 400; ctx.body = { error: 'Expected multipart/form-data' }; return;
        }

        const boundary = _extractBoundary(contentType);
        if (!boundary) { ctx.status = 400; ctx.body = { error: 'Missing multipart boundary' }; return; }

        const MAX = 20 * 1024 * 1024;
        const rawBody = await _readRawBody(ctx.req, MAX);
        const parts = _parseMultipart(rawBody, boundary);

        if (parts.length === 0) { ctx.status = 400; ctx.body = { error: 'No files uploaded' }; return; }

        const appDir = join(appsRoot, appName);
        await mkdir(appDir, { recursive: true });

        const saved: string[] = [];
        for (const part of parts) {
            if (!part.filename) continue;
            const safe = basename(normalize(part.filename));
            if (!safe || safe === '.' || safe === '..') continue;
            const dest = join(appDir, safe);
            // Ensure destination stays within appDir
            const rel = relative(appDir, dest);
            if (rel.startsWith('..') || rel.startsWith(sep + '..')) continue;
            await writeFile(dest, part.data);
            saved.push(safe);
        }

        if (saved.length === 0) { ctx.status = 400; ctx.body = { error: 'No valid files saved' }; return; }
        ctx.body = { saved };
    });

    // Delete an entire app folder
    // DELETE /api/apps/:appName
    router.delete('/api/apps/:appName', async (ctx) => {
        const appName = ctx.params.appName ?? '';
        if (!_isValidAppName(appName)) { ctx.status = 400; ctx.body = { error: 'Invalid app name' }; return; }

        const userId = ctx.state.userId as string;
        const appsRoot = await _appsDir(userId);
        if (!appsRoot) { ctx.status = 500; ctx.body = { error: 'No state dir' }; return; }

        const appDir = join(appsRoot, appName);
        // Verify it exists and is a directory inside appsRoot
        const rel = relative(appsRoot, appDir);
        if (rel.startsWith('..') || rel.includes(sep + '..')) { ctx.status = 400; ctx.body = { error: 'Invalid path' }; return; }

        try {
            const st = await stat(appDir);
            if (!st.isDirectory()) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
            await rm(appDir, { recursive: true, force: true });
            ctx.body = { deleted: appName };
        } catch {
            ctx.status = 404;
            ctx.body = { error: 'App not found' };
        }
    });
}
