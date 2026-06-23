import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const RUNTIME_DIR = join(ROOT, 'runtime');
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
});
