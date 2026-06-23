import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const ROOT = join(REPO_ROOT, 'src');
const RUNTIME_DIR = join(ROOT, 'runtime');
const RUNTIME_PACKAGE_DIR = join(REPO_ROOT, 'packages', 'runtime', 'src');
const SRC_DIR = ROOT;
const FORBIDDEN_IMPORTS = [
    '../routes/',
    '../services/',
    '../app/',
    '../tools/',
    '../llm/',
    '../skills/',
    '../memory/',
    '../agent/',
    '../../web/',
] as const;

function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            if (entry === '__tests__') continue;
            out.push(...listTsFiles(path));
        } else if (entry.endsWith('.ts')) {
            out.push(path);
        }
    }
    return out;
}

describe('runtime import boundary', () => {
    it('does not import app, route, service, or web layers', () => {
        const violations: string[] = [];
        for (const file of listTsFiles(RUNTIME_DIR)) {
            const text = readFileSync(file, 'utf8');
            for (const forbidden of FORBIDDEN_IMPORTS) {
                const pattern = new RegExp(`from\\s+['"]${forbidden.replaceAll('/', '\\/')}`);
                if (pattern.test(text)) {
                    violations.push(`${relative(ROOT, file)} imports ${forbidden}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('production code imports runtime through the workspace package', () => {
        const violations: string[] = [];
        for (const file of listTsFiles(SRC_DIR)) {
            if (file.includes('/__tests__/')) continue;
            if (relative(ROOT, file).startsWith('runtime/')) continue;
            const text = readFileSync(file, 'utf8');
            const pattern = /from\s+['"]((?:\.\.\/)+|\.\/)runtime(?:\/([^'"]+))?['"]/g;
            for (const match of text.matchAll(pattern)) {
                violations.push(`${relative(ROOT, file)} imports src/runtime${match[2] ? `/${match[2]}` : ''}`);
            }
        }
        expect(violations).toEqual([]);
    });

    it('production entrypoints call agent execution through AgentRuntime', () => {
        const violations: string[] = [];
        const allowed = new Set([
            'app/agent-runtime.ts',
            'services/agent-runner.ts',
        ]);
        for (const file of listTsFiles(SRC_DIR)) {
            if (file.includes('/__tests__/')) continue;
            const rel = relative(ROOT, file);
            if (allowed.has(rel)) continue;
            const text = readFileSync(file, 'utf8');
            if (/from\s+['"][^'"]*agent-runner\.js['"]/.test(text)) {
                violations.push(`${rel} imports services/agent-runner`);
            }
        }
        expect(violations).toEqual([]);
    });

    it('runtime package source is self-contained', () => {
        const violations: string[] = [];
        const forbidden = [
            '/src/app/',
            '/src/routes/',
            '/src/services/',
            '/src/tools/',
            '/src/llm/',
            '/src/skills/',
            '/src/memory/',
            '/src/agent/',
            '/web/',
        ];
        for (const file of listTsFiles(RUNTIME_PACKAGE_DIR)) {
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
                const specifier = match[1];
                if (specifier.includes('/src/')) {
                    violations.push(`${relative(REPO_ROOT, file)} imports ${specifier}`);
                }
                if (forbidden.some((entry) => specifier.includes(entry))) {
                    violations.push(`${relative(REPO_ROOT, file)} imports ${specifier}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
