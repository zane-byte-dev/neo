/**
 * workspace.ts — Per-tenant workspace directory management.
 *
 * Each tenant gets an isolated workspace directory under the base WORK_DIR:
 *   {WORK_DIR}/{tenantDirName}/
 *     config/           ← Agent personality & tool config (AGENTS.md, SOUL.md, etc.)
 *       skills/         ← Custom skills in OpenClaw format (SKILL.md per folder)
 *     memory/           ← Short/long-term memory (NOW.md, daily logs, etc.)
 *     archives/         ← Permanent knowledge archive
 *     .tmp/             ← Temporary files
 *
 * On first tenant init, default config files are copied from the template dir.
 */

import { join, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import type { TenantKey } from '../types/platform.js';

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a tenant key ("telegram:123456") to a filesystem-safe directory name
 * ("telegram_123456").
 */
export function tenantDirName(tenantKey: TenantKey): string {
    return tenantKey.replace(':', '_');
}

/**
 * Resolve the absolute workspace directory for a given tenant.
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

// ── Workspace initialization ──────────────────────────────────────────────────

/**
 * Ensure the workspace directory structure exists for a tenant.
 * If config/ is missing, copies default config from the template directory.
 *
 * @param workDir      Absolute path to this tenant's workspace root.
 * @param templateDir  Absolute path to the default config template directory.
 *                     (e.g. resource/config/ — the original config location)
 */
export async function ensureWorkspace(workDir: string, templateDir?: string): Promise<void> {
    // Create directory structure
    const dirs = [
        join(workDir, 'config', 'skills'),
        join(workDir, 'memory'),
        join(workDir, 'archives'),
        join(workDir, '.tmp'),
    ];
    for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
    }

    // Copy default config template if AGENTS.md doesn't exist yet
    const agentsMdPath = join(workDir, 'config', 'AGENTS.md');
    try {
        await fs.access(agentsMdPath);
        // Config already exists, skip
    } catch {
        // Config missing — copy from template
        if (templateDir) {
            await copyConfigTemplate(templateDir, join(workDir, 'config'));
        }
    }
}

/**
 * Copy all .md files from the template directory to the target config directory.
 * Does NOT overwrite existing files.
 */
async function copyConfigTemplate(templateDir: string, targetConfigDir: string): Promise<void> {
    let entries: string[];
    try {
        const dirEnts = await fs.readdir(templateDir);
        entries = dirEnts.filter(f => f.endsWith('.md'));
    } catch {
        console.warn(`[Workspace] Template dir not readable: ${templateDir}`);
        return;
    }

    for (const file of entries) {
        const src = join(templateDir, file);
        const dst = join(targetConfigDir, file);
        try {
            await fs.access(dst);
            // Already exists, skip
        } catch {
            await fs.copyFile(src, dst);
            console.log(`[Workspace] Copied default config: ${file}`);
        }
    }
}
