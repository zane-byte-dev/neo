/**
 * upload.ts — File upload endpoint.
 *
 * POST /api/upload  (multipart/form-data)
 *
 * Accepts images and documents. Returns JSON with:
 *   - For images: { type: 'image', dataUrl: string }
 *   - For documents: { type: 'document', filename, text, pageCount? }
 *
 * Max file size: 20MB (enforced here, bodyParser handles JSON payloads).
 */

import { basename } from 'node:path';
import type Router from '@koa/router';
import { parseDocument, isDocumentType, isImageType } from '../services/document-parser.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
]);

// Allowed document MIME types / extensions
const ALLOWED_DOC_EXTENSIONS = new Set([
    'pdf', 'docx', 'xlsx', 'xls',
    'txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'log', 'html', 'htm',
    'js', 'ts', 'py', 'sh', 'css', 'sql', 'toml', 'ini', 'cfg', 'env',
]);

export function uploadRoute(router: Router): void {
    router.post('/api/upload', async (ctx) => {
        // Koa bodyParser with multipart support is not configured —
        // we manually parse the raw request body from the multipart stream.
        const contentType = ctx.get('content-type') ?? '';

        if (!contentType.includes('multipart/form-data')) {
            ctx.status = 400;
            ctx.body = { error: 'Expected multipart/form-data' };
            return;
        }

        const boundary = extractBoundary(contentType);
        if (!boundary) {
            ctx.status = 400;
            ctx.body = { error: 'Missing multipart boundary' };
            return;
        }

        const rawBody = await readRawBody(ctx.req, MAX_FILE_SIZE);
        const parts = parseMultipart(rawBody, boundary);

        if (parts.length === 0) {
            ctx.status = 400;
            ctx.body = { error: 'No file uploaded' };
            return;
        }

        const results: Array<
            | { type: 'image'; dataUrl: string; filename: string }
            | { type: 'document'; filename: string; text: string; pageCount?: number; mimeType: string }
        > = [];

        for (const part of parts) {
            const filename = sanitizeFilename(part.filename);
            const ext = filename.split('.').pop()?.toLowerCase() ?? '';
            const mimeType = part.contentType || guessMimeType(ext);

            // Validate file type
            if (!ALLOWED_IMAGE_TYPES.has(mimeType) && !ALLOWED_DOC_EXTENSIONS.has(ext)) {
                continue; // silently skip unsupported files
            }

            if (isImageType(mimeType) && ALLOWED_IMAGE_TYPES.has(mimeType)) {
                // Convert image to base64 data URL
                const b64 = part.data.toString('base64');
                const dataUrl = `data:${mimeType};base64,${b64}`;
                results.push({ type: 'image', dataUrl, filename });
            } else if (isDocumentType(mimeType, filename)) {
                // Parse document and extract text
                const parsed = await parseDocument(part.data, filename, mimeType);
                if (parsed) {
                    results.push({
                        type: 'document',
                        filename: parsed.filename,
                        text: parsed.text,
                        pageCount: parsed.pageCount,
                        mimeType: parsed.mimeType,
                    });
                }
            }
        }

        if (results.length === 0) {
            ctx.status = 400;
            ctx.body = { error: 'No supported files found' };
            return;
        }

        ctx.body = { files: results };
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
    // Strip path components and limit length
    return basename(name).slice(0, 255);
}

function extractBoundary(contentType: string): string | null {
    const match = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
    return match?.[1] ?? match?.[2] ?? null;
}

function readRawBody(req: import('node:http').IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let length = 0;
        req.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > limit) {
                req.destroy();
                reject(new Error(`File too large (max ${Math.round(limit / 1024 / 1024)}MB)`));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

interface MultipartPart {
    filename: string;
    contentType: string;
    data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
    const parts: MultipartPart[] = [];
    const boundaryBuf = Buffer.from(`--${boundary}`);
    const bodyStr = body;

    // Find all boundary positions
    let pos = 0;
    const positions: number[] = [];
    while (pos < bodyStr.length) {
        const idx = bodyStr.indexOf(boundaryBuf, pos);
        if (idx === -1) break;
        positions.push(idx);
        pos = idx + boundaryBuf.length;
    }

    for (let i = 0; i < positions.length - 1; i++) {
        const start = positions[i] + boundaryBuf.length;
        const end = positions[i + 1];
        const partBuf = bodyStr.subarray(start, end);

        // Find the blank line separating headers from body (CRLFCRLF)
        const headerEnd = partBuf.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) continue;

        const headerStr = partBuf.subarray(0, headerEnd).toString('utf8');
        // Body starts after \r\n\r\n, ends before trailing \r\n
        let dataBuf = partBuf.subarray(headerEnd + 4);
        // Remove trailing \r\n before the next boundary
        if (dataBuf.length >= 2 && dataBuf[dataBuf.length - 2] === 0x0d && dataBuf[dataBuf.length - 1] === 0x0a) {
            dataBuf = dataBuf.subarray(0, dataBuf.length - 2);
        }

        // Parse headers
        const filenameMatch = /filename="([^"]+)"/i.exec(headerStr);
        const ctMatch = /Content-Type:\s*(.+)/i.exec(headerStr);

        if (!filenameMatch) continue; // skip non-file fields

        parts.push({
            filename: filenameMatch[1],
            contentType: ctMatch?.[1]?.trim() ?? '',
            data: dataBuf,
        });
    }

    return parts;
}

function guessMimeType(ext: string): string {
    const map: Record<string, string> = {
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls: 'application/vnd.ms-excel',
        txt: 'text/plain',
        md: 'text/markdown',
        json: 'application/json',
        csv: 'text/csv',
        xml: 'text/xml',
        yaml: 'text/yaml',
        yml: 'text/yaml',
        log: 'text/plain',
        html: 'text/html',
        htm: 'text/html',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
    };
    return map[ext] ?? 'application/octet-stream';
}
