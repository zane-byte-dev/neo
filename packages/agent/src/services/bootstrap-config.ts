/**
 * bootstrap-config.ts — First-run user provisioning.
 *
 * When neither src/config.local.ts nor process.env supply a user, we fall back
 * to (and create on demand) ~/.neo/config.json so a freshly cloned repo can
 * `npm run dev:bot` without manual editing.
 *
 * Layout:
 *   ~/.neo/config.json                         — JSON form of LocalConfig (chmod 0600)
 *   ~/.neo/workspace/<userId>/                 — workDir
 *   ~/.neo/state/<userId>/                     — stateDir
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { LocalConfig } from '../config.js';
import { writeJsonAtomicSync } from '../utils/atomic-file.js';

const NEO_HOME = join(homedir(), '.neo');
const CONFIG_PATH = join(NEO_HOME, 'config.json');
const DEFAULT_USER_ID = 'default';

/**
 * Try to load an existing ~/.neo/config.json, otherwise generate a single-user
 * default config and persist it. Synchronous so it can run during the
 * top-level await in src/config.ts.
 *
 * Returns the resolved config plus a "freshly bootstrapped" flag so the caller
 * can decide whether to print onboarding instructions.
 */
export function loadOrBootstrapHomeConfig(): { config: LocalConfig; bootstrapped: boolean } {
    if (existsSync(CONFIG_PATH)) {
        try {
            const raw = readFileSync(CONFIG_PATH, 'utf8');
            const parsed = JSON.parse(raw) as LocalConfig;
            if (parsed && Array.isArray(parsed.USERS) && parsed.USERS.length > 0) {
                return { config: parsed, bootstrapped: false };
            }
        } catch (err) {
            console.error(`[Bootstrap] Failed to read ${CONFIG_PATH}: ${(err as Error).message}`);
        }
    }

    const workDir = join(NEO_HOME, 'workspace', DEFAULT_USER_ID);
    const stateDir = join(NEO_HOME, 'state', DEFAULT_USER_ID);
    mkdirSync(workDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(NEO_HOME, { recursive: true });

    const config: LocalConfig = {
        USERS: [
            {
                id: DEFAULT_USER_ID,
                name: 'Default User',
                tenants: [],
                webToken: randomBytes(24).toString('hex'),
                workDir,
                stateDir,
            },
        ],
        SESSION_SECRET: randomBytes(48).toString('hex'),
    };

    writeJsonAtomicSync(CONFIG_PATH, config);
    try { chmodSync(CONFIG_PATH, 0o600); } catch { /* best-effort on Windows */ }

    return { config, bootstrapped: true };
}

/** Print a one-time onboarding banner with the generated login token. */
export function printBootstrapBanner(config: LocalConfig): void {
    const user = config.USERS?.[0];
    if (!user?.webToken) return;
    const port = process.env.WEB_PORT ?? '3000';
    const bar = '─'.repeat(64);
    console.log(`\n${bar}`);
    console.log('  Neo first-run bootstrap');
    console.log(`  Generated default user → ${CONFIG_PATH}`);
    console.log(`  workDir : ${user.workDir}`);
    console.log(`  stateDir: ${user.stateDir}`);
    console.log('');
    console.log(`  Login at: http://localhost:${port}`);
    console.log(`  Web token: ${user.webToken}`);
    console.log('');
    console.log('  Edit ~/.neo/config.json (or src/config.local.ts) to customize.');
    console.log(`${bar}\n`);
}
