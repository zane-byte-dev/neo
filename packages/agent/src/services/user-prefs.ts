/**
 * user-prefs.ts — Per-user runtime preferences (default model, enabled models, ...).
 *
 * Stored at {workDir}/preferences.json. Intentionally simple: loaded on demand
 * by calcUser() and written by the /api/preferences route.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseJsonOr } from '../utils/json.js';
import { log } from '../utils/logger.js';

export interface UserPreferences {
    /** Preferred default model alias (applied when the request does not override). */
    defaultModel?: string;
    /** Whitelist of model aliases exposed in the UI. Empty/undefined = all. */
    enabledModels?: string[];
    /**
     * Tool documentation density injected into the prompt.
     *   - 'lazy' (default): compact catalog + on-demand `search_tools` expansion.
     *   - 'full': legacy full descriptions for every tool.
     */
    toolContext?: 'lazy' | 'full';
}

const FILE_NAME = 'preferences.json';

export async function loadUserPreferences(workDir: string): Promise<UserPreferences> {
    try {
        const raw = await fs.readFile(join(workDir, FILE_NAME), 'utf8');
        const data = parseJsonOr<UserPreferences>(raw, {});
        return sanitize(data);
    } catch {
        return {};
    }
}

export async function saveUserPreferences(workDir: string, prefs: UserPreferences): Promise<UserPreferences> {
    const clean = sanitize(prefs);
    const target = join(workDir, FILE_NAME);
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(target, JSON.stringify(clean, null, 2), 'utf8');
    log.info('UserPrefs', `Saved preferences for ${workDir}: ${JSON.stringify(clean)}`);
    return clean;
}

function sanitize(input: UserPreferences): UserPreferences {
    const out: UserPreferences = {};
    if (typeof input.defaultModel === 'string' && input.defaultModel.trim()) {
        out.defaultModel = input.defaultModel.trim();
    }
    if (Array.isArray(input.enabledModels)) {
        const list = input.enabledModels
            .filter((m): m is string => typeof m === 'string')
            .map((m) => m.trim())
            .filter(Boolean);
        if (list.length) out.enabledModels = [...new Set(list)];
    }
    if (input.toolContext === 'lazy' || input.toolContext === 'full') {
        out.toolContext = input.toolContext;
    }
    return out;
}
