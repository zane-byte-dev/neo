/**
 * src/skills/index.ts — Central registry for all skills.
 *
 * To add a new skill:
 *   1. Create src/skills/my-skill.ts and export a `Skill` object.
 *   2. Import it here and add it to the SKILLS array.
 */
import { registerSkill } from '../lib/gemini-client.js';
import type { Skill } from './_base.js';

import { fetchUrlSkill }              from './fetch-url.js';
import { searchWebSkill }             from './search-web.js';
import { getWeatherSkill }            from './get-weather.js';
import { httpRequestSkill }           from './http-request.js';
import { getDatetimeSkill }           from './get-datetime.js';
import { fetchAiNewsSkill }           from './fetch-ai-news.js';
import { generateWechatArticleSkill } from './generate-wechat-article.js';
import { xifengAuditSkill }           from './xifeng-audit.js';
import { browserFetchSkill }          from './browser-fetch.js';

const SKILLS: Skill[] = [
    fetchUrlSkill,
    searchWebSkill,
    getWeatherSkill,
    httpRequestSkill,
    getDatetimeSkill,
    fetchAiNewsSkill,
    generateWechatArticleSkill,
    xifengAuditSkill,
    browserFetchSkill,
];

export function setupSkills(): void {
    let count = 0;
    for (const skill of SKILLS) {
        if (skill.meta?.enabled === false) continue;
        registerSkill(skill);
        count++;
    }
    console.log(`[Skills] ✅ ${count} skills registered`);
}
