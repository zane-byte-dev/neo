import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

export interface GitSnapshot {
    repoRoot: string;
    dirtyPaths: Set<string>;
}

function parseGitStatusPaths(output: string): Set<string> {
    const paths = new Set<string>();
    for (const line of output.split('\n')) {
        if (!line) continue;
        const pathField = line.slice(3).trim();
        if (!pathField) continue;
        const candidates = pathField.includes(' -> ') ? pathField.split(' -> ') : [pathField];
        for (const candidate of candidates) {
            const normalized = candidate.trim().replace(/^"(.*)"$/, '$1');
            if (normalized) paths.add(normalized);
        }
    }
    return paths;
}

export async function captureGitSnapshot(workDir: string): Promise<GitSnapshot | null> {
    try {
        const { stdout: repoRootStdout } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
        const repoRoot = repoRootStdout.trim();
        if (!repoRoot) return null;
        const { stdout: statusStdout } = await execFileAsync(
            'git',
            ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'],
            { encoding: 'utf8' },
        );
        return { repoRoot, dirtyPaths: parseGitStatusPaths(statusStdout) };
    } catch {
        return null;
    }
}

export async function autoCommitWorkspaceChanges(
    operationName: string,
    before: GitSnapshot | null,
    logScope = 'Workspace',
): Promise<void> {
    if (!before) return;

    const after = await captureGitSnapshot(before.repoRoot);
    if (!after || after.repoRoot !== before.repoRoot) return;

    const newPaths = [...after.dirtyPaths].filter((path) => !before.dirtyPaths.has(path));
    if (newPaths.length === 0) return;

    try {
        await execFileAsync('git', ['-C', before.repoRoot, 'add', '-A', '--', ...newPaths], { encoding: 'utf8' });
        await execFileAsync(
            'git',
            [
                '-C',
                before.repoRoot,
                '-c',
                'user.name=Neo',
                '-c',
                'user.email=neo@local',
                'commit',
                '-m',
                `chore(workspace): apply ${operationName} changes`,
                '--',
                ...newPaths,
            ],
            { encoding: 'utf8' },
        );
        log.info(logScope, 'Auto-committed workspace changes', { operationName, paths: newPaths });
    } catch (err) {
        log.warn(logScope, 'Auto-commit skipped after workspace write', {
            operationName,
            paths: newPaths,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export async function withGitAutoCommit<T>(
    workDir: string,
    operationName: string,
    fn: () => Promise<T>,
    logScope = 'Workspace',
): Promise<T> {
    const snapshot = await captureGitSnapshot(workDir);
    const result = await fn();
    await autoCommitWorkspaceChanges(operationName, snapshot, logScope);
    return result;
}