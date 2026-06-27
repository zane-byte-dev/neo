import { readFileSync } from 'node:fs';

export function parseJsonOr<T>(text: string, fallback: T): T {
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

export function parseJsonLines<T>(text: string): T[] {
    const results: T[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const parsed = parseJsonOr<T | null>(line, null);
        if (parsed !== null) results.push(parsed);
    }
    return results;
}

export function readJsonFileSyncOr<T>(filePath: string, fallback: T): T {
    try {
        return parseJsonOr(readFileSync(filePath, 'utf8'), fallback);
    } catch {
        return fallback;
    }
}