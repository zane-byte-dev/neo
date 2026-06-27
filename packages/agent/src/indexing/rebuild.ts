import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rebuildKnowledgeIndex } from './ingest.js';
import { getUsersConfig } from '../config.js';

function readConfiguredUsers(): Array<{ id: string; workDir?: string; stateDir?: string }> {
    return getUsersConfig().map((u) => ({ id: u.id, workDir: u.workDir, stateDir: u.stateDir }));
}

function resolveTargets(arg?: string): Array<{ label: string; workDir: string; stateDir?: string }> {
    if (arg) {
        if (existsSync(arg)) {
            return [{ label: resolve(arg), workDir: resolve(arg) }];
        }

        const byUserId = readConfiguredUsers().find((user) => user.id === arg && user.workDir);
        if (byUserId?.workDir) {
            return [{
                label: byUserId.id,
                workDir: resolve(byUserId.workDir),
                stateDir: byUserId.stateDir ? resolve(byUserId.stateDir) : undefined,
            }];
        }

        throw new Error(`Unknown workDir or userId: ${arg}`);
    }

    const targets = readConfiguredUsers()
        .filter((user): user is { id: string; workDir: string; stateDir?: string } => Boolean(user.workDir))
        .map((user) => ({
            label: user.id,
            workDir: resolve(user.workDir),
            stateDir: user.stateDir ? resolve(user.stateDir) : undefined,
        }));

    if (!targets.length) {
        throw new Error('No rebuild target found. Pass a workDir/userId or set USERS with workDir.');
    }

    return targets;
}

async function main(): Promise<void> {
    const arg = process.argv[2];
    const targets = resolveTargets(arg);

    for (const target of targets) {
        const summary = await rebuildKnowledgeIndex(target.workDir, target.stateDir ?? target.workDir);
        console.log(`[index:rebuild] ${target.label} -> notebooks=${summary.notebooks} sources=${summary.notebookSources} notes=${summary.notebookNotes} episodic=${summary.episodicEpisodes} semantic=${summary.semanticFacts}`);
    }
}

main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[index:rebuild] failed: ${message}`);
    process.exitCode = 1;
});