import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { isInsidePath, resolveInside, tryResolveInside } from '../path-security.js';

describe('path-security', () => {
    const root = '/tmp/neo-workspace';

    it('resolves relative and absolute paths inside the base directory', () => {
        expect(resolveInside(root, 'notes/a.md')).toBe(resolve(root, 'notes/a.md'));
        expect(resolveInside(root, resolve(root, 'notes/a.md'))).toBe(resolve(root, 'notes/a.md'));
    });

    it('blocks traversal and sibling-prefix escapes', () => {
        expect(() => resolveInside(root, '../neo-workspace-sibling/secret.md')).toThrow('Path traversal blocked');
        expect(() => resolveInside(root, '/tmp/neo-workspace-sibling/secret.md')).toThrow('Path traversal blocked');
        expect(tryResolveInside(root, '/tmp/neo-workspace-sibling/secret.md')).toBeNull();
    });

    it('can require a child path rather than the base directory itself', () => {
        expect(isInsidePath(root, root)).toBe(true);
        expect(isInsidePath(root, root, { allowEqual: false })).toBe(false);
    });
});
