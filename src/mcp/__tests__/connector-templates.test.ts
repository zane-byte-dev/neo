import { describe, it, expect } from 'vitest';
import {
    listConnectorTemplates,
    getConnectorTemplate,
    expandTemplate,
} from '../connector-templates.js';

describe('connector templates', () => {
    it('lists serializable templates without the build closure', () => {
        const templates = listConnectorTemplates();
        expect(templates.length).toBeGreaterThanOrEqual(3);
        const ids = templates.map((t) => t.id);
        expect(ids).toContain('filesystem');
        expect(ids).toContain('github');
        expect(ids).toContain('custom-stdio');
        for (const t of templates) {
            expect(t).not.toHaveProperty('build');
            expect(Array.isArray(t.fields)).toBe(true);
        }
    });

    it('flags the github token field as secret', () => {
        const gh = getConnectorTemplate('github');
        const tokenField = gh?.fields.find((f) => f.key === 'token');
        expect(tokenField?.secret).toBe(true);
        expect(tokenField?.required).toBe(true);
    });

    it('expands the filesystem template into an stdio config', () => {
        const result = expandTemplate('filesystem', { directory: '/tmp/data' });
        expect(result.unknownTemplate).toBe(false);
        expect(result.missing).toEqual([]);
        expect(result.config).toEqual({
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/data'],
        });
    });

    it('reports missing required fields and surfaces secret keys', () => {
        const result = expandTemplate('github', { token: '' });
        expect(result.missing).toEqual(['token']);
        expect(result.config).toBeUndefined();

        const ok = expandTemplate('github', { token: 'ghp_abc' });
        expect(ok.secretKeys).toEqual(['token']);
        expect(ok.config?.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc' });
    });

    it('parses custom stdio args by whitespace and trims cwd', () => {
        const result = expandTemplate('custom-stdio', {
            command: 'npx',
            args: '-y  @scope/server',
            cwd: '  /work  ',
        });
        expect(result.config).toEqual({
            command: 'npx',
            args: ['-y', '@scope/server'],
            cwd: '/work',
        });
    });

    it('flags unknown templates', () => {
        const result = expandTemplate('does-not-exist', {});
        expect(result.unknownTemplate).toBe(true);
        expect(result.config).toBeUndefined();
    });
});
