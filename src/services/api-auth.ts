/**
 * Per-user API token authentication.
 *
 * Tokens are configured via ConfigUser.apiToken in config.local.ts.
 * No UI management — same approach as Claude Code's file-based config.
 */

import { timingSafeEqual } from 'node:crypto';
import type { ConfigUser } from '../config.js';

export function hasApiTokenSync(user: ConfigUser): boolean {
    return Boolean(user.apiToken?.trim());
}

export function matchesApiTokenSync(user: ConfigUser, token: string): boolean {
    if (!token) return false;
    const expected = user.apiToken?.trim() ?? '';
    if (!expected) return false;
    const left = Buffer.from(token, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
}
