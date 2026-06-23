/**
 * Generate a short, URL-safe, collision-resistant ID.
 * Keep this aligned with the app's historical id shape so moving runtime into
 * this package does not alter persisted run/action/event id formats.
 */
import { randomBytes } from 'node:crypto';

export function generateId(): string {
    return randomBytes(4).toString('hex') + Date.now().toString(36);
}
