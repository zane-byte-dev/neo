import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureUserWorkspaceInitialized } from '../workspace-bootstrap.js';

let tempRoot: string;
let workDir: string;
let stateDir: string;

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'neo-workspace-bootstrap-'));
    workDir = join(tempRoot, 'workspace');
    stateDir = join(tempRoot, 'state');
});

afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});

describe('ensureUserWorkspaceInitialized', () => {
    it('copies the example workspace and creates required state directories', async () => {
        await ensureUserWorkspaceInitialized(workDir, stateDir);

        await expect(fs.readFile(join(workDir, 'AGENTS.md'), 'utf8')).resolves.toContain('# AGENTS');
        await expect(fs.readFile(join(workDir, 'USER.md'), 'utf8')).resolves.toContain('# USER');
        await expect(fs.readFile(join(workDir, 'notebooks', 'welcome.md'), 'utf8')).resolves.toContain('欢迎使用 Neo');
        await expect(fs.stat(join(stateDir, 'skills'))).resolves.toBeDefined();
        await expect(fs.stat(join(stateDir, 'tools'))).resolves.toBeDefined();
    });

    it('does not overwrite files that already exist in the workspace', async () => {
        await fs.mkdir(workDir, { recursive: true });
        await fs.writeFile(join(workDir, 'AGENTS.md'), '# Custom Agent\n\nKeep this.', 'utf8');

        await ensureUserWorkspaceInitialized(workDir, stateDir);

        await expect(fs.readFile(join(workDir, 'AGENTS.md'), 'utf8')).resolves.toBe('# Custom Agent\n\nKeep this.');
        await expect(fs.readFile(join(workDir, 'SOUL.md'), 'utf8')).resolves.toContain('# SOUL');
    });
});