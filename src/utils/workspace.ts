/**
 * workspace.ts — Per-user workspace directory management.
 *
 * Each user gets an isolated workspace directory under the base WORK_DIR:
 *   {WORK_DIR}/{userId}/
 *     skills/         ← Custom skills in OpenClaw format (SKILL.md per folder)
 *     memory/           ← Short/long-term memory (NOW.md, daily logs, etc.)
 *     archives/         ← Permanent knowledge archive
 *     .tmp/             ← Temporary files
 *
 * On first user init, default config files are copied from the template dir.
 */

import { join, resolve } from 'node:path';
import type { TenantKey } from '../types/platform.js';
import type { UserId } from '../types/platform.js';

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a tenant key ("telegram:123456") to a filesystem-safe directory name
 * ("telegram_123456").
 * @deprecated Use resolveUserWorkspaceDir instead. Kept for migration utilities.
 */
export function tenantDirName(tenantKey: TenantKey): string {
    return tenantKey.replace(':', '_');
}

/**
 * Resolve the absolute workspace directory for a given user.
 */
export function resolveUserWorkspaceDir(baseWorkDir: string, userId: UserId): string {
    return resolve(baseWorkDir, userId);
}

/**
 * Resolve the absolute workspace directory for a given tenant.
 * @deprecated Use resolveUserWorkspaceDir instead.
 */
export function resolveWorkspaceDir(baseWorkDir: string, tenantKey: TenantKey): string {
    return resolve(baseWorkDir, tenantDirName(tenantKey));
}

/**
 * Resolve the config directory inside a tenant's workspace.
 */
export function resolveConfigDir(workDir: string): string {
    return join(workDir, 'config');
}

/**
 * Resolve the skills directory inside a tenant's workspace config.
 */
export function resolveSkillsDir(workDir: string): string {
    return join(workDir, 'config', 'skills');
}


