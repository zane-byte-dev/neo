/**
 * Lightweight tests for the gemini-acp provider — covers the no-op branches
 * (no ACP process running) without spawning the real `gemini --acp` CLI.
 */
import { describe, it, expect } from 'vitest';
import { isAcpAvailable, shutdownAcp } from '../gemini-acp.js';

describe('gemini-acp provider', () => {
    it('isAcpAvailable returns false when the process is not running', () => {
        // Module state starts uninitialised in this isolated test file.
        expect(isAcpAvailable()).toBe(false);
    });

    it('shutdownAcp is a no-op when no process is running', () => {
        expect(() => shutdownAcp()).not.toThrow();
    });
});
