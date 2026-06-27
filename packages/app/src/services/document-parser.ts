/**
 * document-parser.ts — Extract text from uploaded documents (PDF, Word, Excel).
 *
 * Supported formats:
 *   - PDF (.pdf) → pdf-parse
 *   - Word (.docx) → mammoth
 *   - Excel (.xlsx, .xls) → xlsx
 *   - Plain text (.txt, .md, .json, .csv, .xml, .yaml, .yml, .log) → UTF-8
 */

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

/** Maximum text length to extract from a single document (chars). */
const MAX_EXTRACT_LENGTH = 100_000;

export interface ParsedDocument {
    /** Extracted text content */
    text: string;
    /** Number of pages (PDF) or sheets (Excel), if applicable */
    pageCount?: number;
    /** Original filename */
    filename: string;
    /** Detected MIME type */
    mimeType: string;
}

const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'log', 'html', 'htm',
    'js', 'ts', 'py', 'sh', 'css', 'sql', 'toml', 'ini', 'cfg', 'env',
]);

/**
 * Parse a document buffer and extract text content.
 * Returns null if the file type is not supported.
 */
export async function parseDocument(
    buffer: Buffer,
    filename: string,
    mimeType: string,
): Promise<ParsedDocument | null> {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';

    // PDF
    if (ext === 'pdf' || mimeType === 'application/pdf') {
        return parsePdf(buffer, filename);
    }

    // Word (.docx)
    if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return parseDocx(buffer, filename);
    }

    // Excel (.xlsx, .xls)
    if (ext === 'xlsx' || ext === 'xls' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimeType === 'application/vnd.ms-excel') {
        return parseExcel(buffer, filename, mimeType);
    }

    // Plain text files
    if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/')) {
        const text = buffer.toString('utf8').slice(0, MAX_EXTRACT_LENGTH);
        return { text, filename, mimeType };
    }

    return null;
}

async function parsePdf(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const pdf = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await pdf.getText();
    const info = await pdf.getInfo();
    const pageCount = info.total ?? undefined;
    await pdf.destroy();
    return {
        text: textResult.text.slice(0, MAX_EXTRACT_LENGTH),
        pageCount,
        filename,
        mimeType: 'application/pdf',
    };
}

async function parseDocx(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const result = await mammoth.extractRawText({ buffer });
    return {
        text: result.value.slice(0, MAX_EXTRACT_LENGTH),
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
}

async function parseExcel(buffer: Buffer, filename: string, mimeType: string): Promise<ParsedDocument> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const lines: string[] = [];

    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        lines.push(`## Sheet: ${name}`);
        const csv = XLSX.utils.sheet_to_csv(sheet);
        lines.push(csv);
        lines.push('');
    }

    const text = lines.join('\n').slice(0, MAX_EXTRACT_LENGTH);
    return {
        text,
        pageCount: workbook.SheetNames.length,
        filename,
        mimeType,
    };
}

/** Check if a given MIME type or extension is a parseable document. */
export function isDocumentType(mimeType: string, filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return (
        ext === 'pdf' || ext === 'docx' || ext === 'xlsx' || ext === 'xls' ||
        TEXT_EXTENSIONS.has(ext) ||
        mimeType === 'application/pdf' ||
        mimeType.includes('wordprocessingml') ||
        mimeType.includes('spreadsheetml') ||
        mimeType.includes('ms-excel') ||
        mimeType.startsWith('text/')
    );
}

/** Check if a given MIME type is an image. */
export function isImageType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
}

// ── URL / YouTube source fetching ────────────────────────────────────────────

const URL_FETCH_TIMEOUT = 15_000;

function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractTitle(html: string): string {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Detect if a URL points to YouTube. */
export function isYouTubeUrl(url: string): boolean {
    return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/i.test(url);
}

function extractYouTubeId(url: string): string | null {
    const patterns = [
        /[?&]v=([\w-]{11})/,
        /youtu\.be\/([\w-]{11})/,
        /youtube\.com\/shorts\/([\w-]{11})/,
        /youtube\.com\/embed\/([\w-]{11})/,
    ];
    for (const re of patterns) {
        const m = url.match(re);
        if (m) return m[1];
    }
    return null;
}

export interface ParsedUrl {
    text: string;
    title: string;
    url: string;
}

/** Fetch a URL and return readable plain text + extracted title. */
export async function parseUrl(url: string): Promise<ParsedUrl> {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http:// or https://');

    const res = await fetch(url, {
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Neo-Notebook/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} when fetching URL`);

    const contentType = res.headers.get('content-type') ?? '';

    // PDF URL
    if (contentType.includes('application/pdf') || /\.pdf(\?|$)/i.test(url)) {
        const buf = Buffer.from(await res.arrayBuffer());
        const parsed = await parsePdf(buf, url.split('/').pop() ?? 'document.pdf');
        return { text: parsed.text, title: parsed.filename, url };
    }

    const html = await res.text();
    const title = extractTitle(html) || new URL(url).hostname;
    const text = htmlToText(html).slice(0, MAX_EXTRACT_LENGTH);
    return { text, title, url };
}

export interface ParsedYouTube {
    text: string;
    title: string;
    videoId: string;
    url: string;
}

/**
 * Parse a YouTube URL — extracts title + transcript (if captions available).
 * Falls back to the video page description if no transcript can be retrieved.
 */
export async function parseYouTube(url: string): Promise<ParsedYouTube> {
    const videoId = extractYouTubeId(url);
    if (!videoId) throw new Error('Could not extract YouTube video id');

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let html = '';
    try {
        const res = await fetch(watchUrl, {
            signal: AbortSignal.timeout(URL_FETCH_TIMEOUT),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Neo-Notebook/1.0)' },
        });
        if (res.ok) html = await res.text();
    } catch { /* continue */ }

    const title = (html.match(/<meta\s+name="title"\s+content="([^"]+)"/)?.[1]
        || html.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || `YouTube ${videoId}`)
        .replace(/ - YouTube$/, '').trim();

    const transcript = await _tryFetchYouTubeTranscript(videoId, html).catch(() => '');
    if (transcript) {
        return {
            text: transcript.slice(0, MAX_EXTRACT_LENGTH),
            title,
            videoId,
            url: watchUrl,
        };
    }

    // Fallback: meta description
    const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1]
        || html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\n/g, '\n')
        || '';
    return {
        text: description
            ? `[YouTube video — transcript unavailable]\n\n${description}`
            : `[YouTube video ${videoId} — no transcript or description available]`,
        title,
        videoId,
        url: watchUrl,
    };
}

/** Try to fetch YouTube captions by parsing the player response. */
async function _tryFetchYouTubeTranscript(videoId: string, html: string): Promise<string> {
    // Extract the captions track URL from the embedded player response JSON.
    const m = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
    if (!m) return '';
    let tracks: Array<{ baseUrl: string; languageCode?: string; name?: { simpleText?: string } }> = [];
    try { tracks = JSON.parse(m[1]); } catch { return ''; }
    if (!tracks.length) return '';

    // Prefer English or the first track
    const track = tracks.find(t => t.languageCode?.startsWith('en')) ?? tracks[0];
    if (!track?.baseUrl) return '';

    const res = await fetch(track.baseUrl.replace(/\\u0026/g, '&'), {
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT),
    });
    if (!res.ok) return '';

    const xml = await res.text();
    // Parse simple <text>...</text> entries
    const lines: string[] = [];
    for (const mt of xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)) {
        const t = mt[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\n/g, ' ')
            .trim();
        if (t) lines.push(t);
        if (videoId /* keep reference */ && lines.length > 5000) break;
    }
    return lines.join(' ');
}
