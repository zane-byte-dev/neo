/**
 * src/tools/index.ts — Central registry for all tools.
 *
 * To add a new tool:
 *   1. Create src/tools/my-tool.ts and export a `Tool` object.
 *   2. Import it here and add it to the TOOLS array.
 */
import { registerTool } from '../lib/gemini-client.js';
import type { Tool } from './_base.js';

import { fetchUrlTool }              from './fetch-url.js';
import { searchWebTool }             from './search-web.js';
import { getWeatherTool }            from './get-weather.js';
import { httpRequestTool }           from './http-request.js';
import { getDatetimeTool }           from './get-datetime.js';
import { fetchAiNewsTool }           from './fetch-ai-news.js';
import { generateWechatArticleTool } from './generate-wechat-article.js';
import { xifengAuditTool }           from './xifeng-audit.js';
import { browserFetchTool }          from './browser-fetch.js';

const TOOLS: Tool[] = [
    fetchUrlTool,
    searchWebTool,
    getWeatherTool,
    httpRequestTool,
    getDatetimeTool,
    fetchAiNewsTool,
    generateWechatArticleTool,
    xifengAuditTool,
    browserFetchTool,
];

export function setupTools(): void {
    let count = 0;
    for (const tool of TOOLS) {
        if (tool.meta?.enabled === false) continue;
        registerTool(tool);
        count++;
    }
    console.log(`[Tools] ✅ ${count} tools registered`);
}
