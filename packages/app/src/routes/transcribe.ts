/**
 * transcribe.ts — Audio transcription endpoint.
 *
 * POST /api/transcribe  (multipart/form-data)
 *
 * Accepts a single audio file. Returns JSON:
 *   { text: string }
 *
 * Max audio size: 25MB (Whisper limit).
 * Supported formats: webm, mp4, ogg, wav, m4a, flac, mp3 (provider-dependent).
 */

import type Router from '@koa/router';
import { transcribeAudio, MAX_AUDIO_BYTES } from '../services/transcription.js';
import { log } from '@neo/agent/utils/logger.js';

const ALLOWED_AUDIO_MIME = new Set([
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/flac',
    'audio/x-flac',
    'audio/m4a',
    'audio/x-m4a',
    'video/webm', // Chrome encodes MediaRecorder audio as video/webm
    'video/mp4',
]);

export function register(router: Router): void {
    router.post('/api/transcribe', async (ctx) => {
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

        let rawBody: Buffer;
        try {
            rawBody = await readRawBody(ctx.req, MAX_AUDIO_BYTES);
        } catch (err) {
            ctx.status = 413;
            ctx.body = { error: err instanceof Error ? err.message : 'Audio too large' };
            return;
        }

        const parts = parseMultipart(rawBody, boundary);
        if (parts.length === 0) {
            ctx.status = 400;
            ctx.body = { error: 'No audio file found in request' };
            return;
        }

        const part = parts[0];
        const mimeType = part.contentType || guessMimeType(part.filename);

        if (!ALLOWED_AUDIO_MIME.has(mimeType.split(';')[0].trim())) {
            ctx.status = 415;
            ctx.body = { error: `Unsupported audio type: ${mimeType}` };
            return;
        }

        try {
            const text = await transcribeAudio({
                buffer: part.data,
                mimeType: mimeType.split(';')[0].trim(),
                filename: part.filename,
            });
            ctx.body = { text };
        } catch (err) {
            log.warn('Transcription', `Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
            ctx.status = 503;
            ctx.body = {
                error: err instanceof Error ? err.message : 'Transcription failed',
            };
        }
    });
}

// ── Multipart helpers (mirrors upload.ts) ─────────────────────────────────────

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
                reject(new Error(`Audio too large (max ${Math.round(limit / 1024 / 1024)}MB)`));
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

    let pos = 0;
    const positions: number[] = [];
    while (pos < body.length) {
        const idx = body.indexOf(boundaryBuf, pos);
        if (idx === -1) break;
        positions.push(idx);
        pos = idx + boundaryBuf.length;
    }

    for (let i = 0; i < positions.length - 1; i++) {
        const start = positions[i] + boundaryBuf.length;
        const end = positions[i + 1];
        const partBuf = body.subarray(start, end);

        const headerEnd = partBuf.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) continue;

        const headerStr = partBuf.subarray(0, headerEnd).toString('utf8');
        let dataBuf = partBuf.subarray(headerEnd + 4);
        if (dataBuf.length >= 2 && dataBuf[dataBuf.length - 2] === 0x0d && dataBuf[dataBuf.length - 1] === 0x0a) {
            dataBuf = dataBuf.subarray(0, dataBuf.length - 2);
        }

        const filenameMatch = /filename="([^"]+)"/i.exec(headerStr);
        const ctMatch = /Content-Type:\s*(.+)/i.exec(headerStr);

        // Allow parts without filename (browser sends Blob without name)
        const filename = filenameMatch?.[1] ?? 'audio.webm';
        parts.push({
            filename,
            contentType: ctMatch?.[1]?.trim() ?? '',
            data: dataBuf,
        });
    }

    return parts;
}

function guessMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        webm: 'audio/webm',
        ogg: 'audio/ogg',
        mp4: 'audio/mp4',
        m4a: 'audio/m4a',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        flac: 'audio/flac',
    };
    return map[ext] ?? 'audio/webm';
}
