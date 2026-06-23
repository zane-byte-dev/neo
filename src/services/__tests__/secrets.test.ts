import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmp: string;
const ORIGINAL_CONFIG_PATH = process.env.NEO_CONFIG_PATH;
const ORIGINAL_GEMINI = process.env.GEMINI_API_KEY;
const ORIGINAL_OPENAI = process.env.OPENAI_API_KEY;
const ORIGINAL_CLAUDE_CODE_BASE_URL = process.env.CLAUDE_CODE_BASE_URL;
const ORIGINAL_CLAUDE_CODE_TOKEN = process.env.CLAUDE_CODE_TOKEN;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'secrets-'));
    process.env.NEO_CONFIG_PATH = join(tmp, 'config.json');
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLAUDE_CODE_BASE_URL;
    delete process.env.CLAUDE_CODE_TOKEN;
});

afterEach(async () => {
    rmSync(tmp, { recursive: true, force: true });
    if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.NEO_CONFIG_PATH;
    else process.env.NEO_CONFIG_PATH = ORIGINAL_CONFIG_PATH;
    if (ORIGINAL_GEMINI === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL_GEMINI;
    if (ORIGINAL_OPENAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI;
    if (ORIGINAL_CLAUDE_CODE_BASE_URL === undefined) delete process.env.CLAUDE_CODE_BASE_URL;
    else process.env.CLAUDE_CODE_BASE_URL = ORIGINAL_CLAUDE_CODE_BASE_URL;
    if (ORIGINAL_CLAUDE_CODE_TOKEN === undefined) delete process.env.CLAUDE_CODE_TOKEN;
    else process.env.CLAUDE_CODE_TOKEN = ORIGINAL_CLAUDE_CODE_TOKEN;
    vi.resetModules();
    const mod = await import('../secrets.js');
    mod.resetSecretsCache();
});

describe('secrets store', () => {
    it('falls back to process.env when no file present', async () => {
        process.env.OPENAI_API_KEY = 'sk-from-env';
        const { getSecret, resetSecretsCache } = await import('../secrets.js');
        resetSecretsCache();
        expect(getSecret('OPENAI_API_KEY')).toBe('sk-from-env');
        expect(getSecret('GEMINI_API_KEY')).toBe('');
    });

    it('reads from config.json secrets field; file overrides env', async () => {
        process.env.OPENAI_API_KEY = 'sk-from-env';
        writeFileSync(process.env.NEO_CONFIG_PATH!, JSON.stringify({
            secrets: {
                GEMINI_API_KEY: 'AIza-real',
                OPENAI_API_KEY: 'sk-real',
                CLAUDE_CODE_BASE_URL: 'https://proxy.example.com/v1',
                CLAUDE_CODE_TOKEN: 'cc-real',
            },
        }));

        const { getSecret, getSecretsStatus, resetSecretsCache } = await import('../secrets.js');
        resetSecretsCache();
        expect(getSecret('GEMINI_API_KEY')).toBe('AIza-real');
        expect(getSecret('OPENAI_API_KEY')).toBe('sk-real');
        expect(getSecret('CLAUDE_CODE_BASE_URL')).toBe('https://proxy.example.com/v1');
        expect(getSecret('CLAUDE_CODE_TOKEN')).toBe('cc-real');

        const status = await getSecretsStatus();
        expect(status.GEMINI_API_KEY.source).toBe('file');
        expect(status.GEMINI_API_KEY.masked.endsWith('real')).toBe(true);
        expect(status.OPENAI_API_KEY.source).toBe('file');
        expect(status.DEEPSEEK_API_KEY.source).toBe('none');
    });

    it('updateSecrets persists and merges into existing config', async () => {
        writeFileSync(process.env.NEO_CONFIG_PATH!, JSON.stringify({ existingKey: 'keep' }));
        const { updateSecrets, getSecret, resetSecretsCache } = await import('../secrets.js');

        await updateSecrets({ GEMINI_API_KEY: 'AIza-new' });
        resetSecretsCache();
        expect(getSecret('GEMINI_API_KEY')).toBe('AIza-new');

        const raw = JSON.parse(require('fs').readFileSync(process.env.NEO_CONFIG_PATH!, 'utf8'));
        expect(raw.existingKey).toBe('keep');
        expect(raw.secrets.GEMINI_API_KEY).toBe('AIza-new');
    });

    it('clears entry on empty string and falls back to env', async () => {
        process.env.GEMINI_API_KEY = 'AIza-env';
        const { updateSecrets, getSecret, resetSecretsCache } = await import('../secrets.js');

        await updateSecrets({ GEMINI_API_KEY: 'override' });
        resetSecretsCache();
        expect(getSecret('GEMINI_API_KEY')).toBe('override');

        await updateSecrets({ GEMINI_API_KEY: '' });
        resetSecretsCache();
        expect(getSecret('GEMINI_API_KEY')).toBe('AIza-env');
    });

    it('ignores unknown keys', async () => {
        const { updateSecrets, getSecretsStatus } = await import('../secrets.js');
        await updateSecrets({ FOO_BAR: 'x', GEMINI_API_KEY: 'AIza' } as Record<string, unknown>);
        const status = await getSecretsStatus();
        expect(status.GEMINI_API_KEY.hasValue).toBe(true);
        expect(Object.keys(status)).not.toContain('FOO_BAR');
    });
});
