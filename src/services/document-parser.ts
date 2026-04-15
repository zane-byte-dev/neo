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
