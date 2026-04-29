/**
 * id-generator.ts — Centralized, collision-resistant ID generation.
 */
import { randomBytes } from 'node:crypto';

/**
 * Generate a short, URL-safe, collision-resistant ID.
 * Format: 8 random hex chars + timestamp in base36 (e.g. "a3f1b2c9-m5k7x9z")
 */
export function generateId(): string {
    return randomBytes(4).toString('hex') + Date.now().toString(36);
}
