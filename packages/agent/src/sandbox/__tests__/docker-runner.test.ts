import { describe, it, expect } from 'vitest';
import { buildDockerRunArgs } from '../docker-runner.js';

describe('buildDockerRunArgs', () => {
    it('includes resource caps, network=none, and workDir mount', () => {
        const args = buildDockerRunArgs({ workDir: '/abs/work', readonly: false });
        expect(args).toContain('run');
        expect(args).toContain('--rm');
        // Resource caps
        const memIdx = args.indexOf('--memory');
        expect(memIdx).toBeGreaterThanOrEqual(0);
        expect(args[memIdx + 1]).toMatch(/^\d+m$/);
        expect(args).toContain('--cpus');
        expect(args).toContain('--pids-limit');
        // Privilege hardening
        expect(args).toContain('--cap-drop');
        expect(args).toContain('ALL');
        expect(args).toContain('--security-opt');
        expect(args).toContain('no-new-privileges');
        // Mount
        const vIdx = args.indexOf('-v');
        expect(args[vIdx + 1]).toBe('/abs/work:/work:rw');
        // Working dir inside container
        const wIdx = args.indexOf('-w');
        expect(args[wIdx + 1]).toBe('/work');
    });

    it('uses ro mount when readonly=true', () => {
        const args = buildDockerRunArgs({ workDir: '/x', readonly: true });
        const vIdx = args.indexOf('-v');
        expect(args[vIdx + 1]).toBe('/x:/work:ro');
    });

    it('accepts a custom image override', () => {
        const args = buildDockerRunArgs({ workDir: '/x', readonly: false, image: 'python:3.12-slim' });
        expect(args[args.length - 1]).toBe('python:3.12-slim');
    });
});
