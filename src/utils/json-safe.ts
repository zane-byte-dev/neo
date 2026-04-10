/**
 * json-safe.ts — Safe JSON parsing utilities.
 */

/**
 * Safely parse a JSON string, returning a fallback on failure.
 */
export function jsonParse<T>(str: string | null | undefined, fallback: T): T {
    if (!str) return fallback;
    try {
        return JSON.parse(str) as T;
    } catch {
        return fallback;
    }
}
