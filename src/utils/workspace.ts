/**
 * workspace.ts — Per-user workspace directory management.
 */

import { resolve } from 'node:path';
import type { UserId } from '../types/platform.js';

export function resolveUserWorkspaceDir(baseWorkDir: string, userId: UserId): string {
    return resolve(baseWorkDir, userId);
}
