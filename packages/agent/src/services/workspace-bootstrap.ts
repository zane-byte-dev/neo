import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../utils/logger.js';

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../examples/workspace');
const STATE_SUBDIRS = ['skills', 'tools'];

export async function ensureUserWorkspaceInitialized(workDir: string, stateDir: string): Promise<void> {
    await mkdir(workDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    const createdWorkspaceEntries: string[] = [];
    await copyMissingTree(TEMPLATE_DIR, workDir, workDir, createdWorkspaceEntries);

    const createdStateDirs: string[] = [];
    for (const name of STATE_SUBDIRS) {
        const targetDir = join(stateDir, name);
        const existed = await pathExists(targetDir);
        await mkdir(targetDir, { recursive: true });
        if (!existed) createdStateDirs.push(name);
    }

    if (createdWorkspaceEntries.length || createdStateDirs.length) {
        log.info(
            'UserWorkspace',
            `Bootstrapped user workspace (${createdWorkspaceEntries.length} template entries, ${createdStateDirs.length} state dirs): ${workDir}`,
        );
    }
}

async function copyMissingTree(
    sourceDir: string,
    targetDir: string,
    workspaceRoot: string,
    createdEntries: string[],
): Promise<void> {
    let entries: Dirent[];
    try {
        entries = await readdir(sourceDir, { withFileTypes: true });
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            log.warn('UserWorkspace', `Workspace template directory not found: ${sourceDir}`);
            return;
        }
        throw error;
    }

    for (const entry of entries) {
        const sourcePath = join(sourceDir, entry.name);
        const targetPath = join(targetDir, entry.name);

        if (entry.isDirectory()) {
            await mkdir(targetPath, { recursive: true });
            await copyMissingTree(sourcePath, targetPath, workspaceRoot, createdEntries);
            continue;
        }

        if (!entry.isFile()) continue;
        if (await pathExists(targetPath)) continue;

        await mkdir(dirname(targetPath), { recursive: true });
        await copyFile(sourcePath, targetPath);
        createdEntries.push(relative(workspaceRoot, targetPath));
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return false;
        throw error;
    }
}