/**
 * packages/agent/src/config.local.example.ts — Template for local configuration.
 *
 * You usually do NOT need to copy this file. On first run, if neither
 * packages/agent/src/config.local.ts nor the USERS env var is set, Neo will auto-generate
 * ~/.neo/config.json with a single default user (and random webToken /
 * SESSION_SECRET) and print the login token to the console.
 *
 * Use this template only if you want the config tracked alongside the repo or
 * need multiple users. Steps:
 *   cp packages/agent/src/config.local.example.ts packages/agent/src/config.local.ts
 *
 * config.local.ts is gitignored — your secrets stay local. Values here take
 * precedence over ~/.neo/config.json.
 *
 * Model calls currently read DEEPSEEK_API_KEY from the environment. Do NOT
 * put real provider keys here.
 */

import type { LocalConfig } from './config.js';

const config: LocalConfig = {
    /**
     * Configured users. Each user owns a workspace + state directory and may
     * be addressable from future external integrations via the `tenants` list.
     */
    USERS: [
        {
            id: 'change-me',
            name: 'Your Name',
            tenants: [],
            webToken: 'change-me',
            apiToken: 'change-me-api-token',
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
