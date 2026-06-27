import type { KnowledgeChunkInput, KnowledgeChunkSeed } from './types.js';

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 100;
const MIN_BREAK_RATIO = 0.6;

interface Section {
    text: string;
    start: number;
    headingPath: string | null;
}

function splitIntoSections(text: string): Section[] {
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const matches = [...text.matchAll(headingRegex)];
    if (!matches.length) {
        return [{ text, start: 0, headingPath: null }];
    }

    const sections: Section[] = [];
    const headingStack: string[] = [];
    let cursor = 0;
    let currentHeadingPath: string | null = null;

    for (const match of matches) {
        const index = match.index ?? 0;
        if (index > cursor) {
            const sectionText = text.slice(cursor, index);
            if (sectionText.trim()) {
                sections.push({ text: sectionText, start: cursor, headingPath: currentHeadingPath });
            }
        }

        const level = match[1].length;
        const heading = match[2].trim();
        headingStack.splice(level - 1);
        headingStack[level - 1] = heading;
        currentHeadingPath = headingStack.join(' > ');
        cursor = index;
    }

    const tail = text.slice(cursor);
    if (tail.trim()) {
        sections.push({ text: tail, start: cursor, headingPath: currentHeadingPath });
    }

    return sections.length ? sections : [{ text, start: 0, headingPath: null }];
}

function trimSliceBounds(slice: string): { startOffset: number; endOffset: number } {
    let startOffset = 0;
    let endOffset = slice.length;

    while (startOffset < endOffset && /\s/.test(slice[startOffset])) startOffset += 1;
    while (endOffset > startOffset && /\s/.test(slice[endOffset - 1])) endOffset -= 1;

    return { startOffset, endOffset };
}

function chooseSplitPoint(sectionText: string, start: number, tentativeEnd: number): number {
    if (tentativeEnd >= sectionText.length) return sectionText.length;

    const minBreak = start + Math.floor((tentativeEnd - start) * MIN_BREAK_RATIO);
    const paragraphBreak = sectionText.lastIndexOf('\n\n', tentativeEnd);
    if (paragraphBreak >= minBreak) return paragraphBreak;

    const lineBreak = sectionText.lastIndexOf('\n', tentativeEnd);
    if (lineBreak >= minBreak) return lineBreak;

    return tentativeEnd;
}

export function buildKnowledgeChunks(input: KnowledgeChunkInput): KnowledgeChunkSeed[] {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    const overlapChars = Math.min(input.overlapChars ?? DEFAULT_OVERLAP_CHARS, Math.floor(maxChars / 3));
    const sections = splitIntoSections(input.text);
    const chunks: KnowledgeChunkSeed[] = [];
    let ordinal = 0;

    for (const section of sections) {
        let localStart = 0;

        while (localStart < section.text.length) {
            const tentativeEnd = Math.min(localStart + maxChars, section.text.length);
            let localEnd = chooseSplitPoint(section.text, localStart, tentativeEnd);
            if (localEnd <= localStart) localEnd = tentativeEnd;

            const rawSlice = section.text.slice(localStart, localEnd);
            const { startOffset, endOffset } = trimSliceBounds(rawSlice);
            const chunkText = rawSlice.slice(startOffset, endOffset);

            if (chunkText) {
                chunks.push({
                    ordinal,
                    text: chunkText,
                    charStart: section.start + localStart + startOffset,
                    charEnd: section.start + localStart + endOffset,
                    headingPath: section.headingPath,
                });
                ordinal += 1;
            }

            if (localEnd >= section.text.length) break;
            localStart = Math.max(localEnd - overlapChars, localStart + 1);
        }
    }

    return chunks;
}