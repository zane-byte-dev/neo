import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rebuildKnowledgeIndex } from './ingest.js';

interface ConfigUser {
    id: string;
    workspaceDir?: string;
}

function readConfiguredUsers(): ConfigUser[] {
    try {
        const raw = process.env.USERS;
        if (!raw) return [];
        const users = JSON.parse(raw) as ConfigUser[];
        return Array.isArray(users) ? users : [];
    } catch {
        return [];
    }
}

function resolveTargets(arg?: string): Array<{ label: string; workDir: string }> {
    if (arg) {
        if (existsSync(arg)) {
            return [{ label: resolve(arg), workDir: resolve(arg) }];
        }

        const byUserId = readConfiguredUsers().find((user) => user.id === arg && user.workspaceDir);
        if (byUserId?.workspaceDir) {
            return [{ label: byUserId.id, workDir: resolve(byUserId.workspaceDir) }];
        }

        throw new Error(`Unknown workDir or userId: ${arg}`);
    }

    const targets = readConfiguredUsers()
        .filter((user): user is ConfigUser & { workspaceDir: string } => Boolean(user.workspaceDir))
        .map((user) => ({ label: user.id, workDir: resolve(user.workspaceDir) }));

    if (!targets.length) {
        throw new Error('No rebuild target found. Pass a workDir/userId or set USERS with workspaceDir.');
    }

    return targets;
}

async function main(): Promise<void> {
    const arg = process.argv[2];
    const targets = resolveTargets(arg);

    for (const target of targets) {
        const summary = await rebuildKnowledgeIndex(target.workDir);
        console.log(`[index:rebuild] ${target.label} -> notebooks=${summary.notebooks} sources=${summary.notebookSources} notes=${summary.notebookNotes} episodic=${summary.episodicEpisodes} semantic=${summary.semanticFacts}`);
    }
}

main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[index:rebuild] failed: ${message}`);
    process.exitCode = 1;
});