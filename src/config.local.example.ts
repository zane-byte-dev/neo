/**
 * src/config.local.example.ts — Template for local configuration.
 *
 * Copy this file to src/config.local.ts and customize for your environment.
 *   cp src/config.local.example.ts src/config.local.ts
 *
 * config.local.ts is gitignored — your secrets stay local.
 *
 * API keys (Gemini / DeepSeek / OpenAI / Anthropic) and Telegram tokens are
 * managed in the UI (Models page → Credentials) and stored encrypted under
 * {stateDir}/secrets.json.enc. Do NOT put them here.
 */

import type { LocalConfig } from './config.js';

const config: LocalConfig = {
    /**
     * Configured users. Each user owns a workspace + state directory and may
     * be addressable from external integrations via the `tenants` list
     * (e.g. "telegram:<chat_id>", "github:<login>").
     */
    USERS: [
        {
            id: 'change-me',
            name: 'Your Name',
            tenants: [],
            webToken: 'change-me',
            workDir: '/absolute/path/to/your/workspace/project',
            stateDir: '/absolute/path/to/your/workspace/state',
        },
    ],

    /**
     * Random string used to sign Koa session cookies AND to derive the
        * encryption key for {stateDir}/secrets.json.enc. Changing this invalidates
     * all stored credentials and active sessions.
     */
    SESSION_SECRET: 'change-me-to-a-long-random-string',
};

export default config;
