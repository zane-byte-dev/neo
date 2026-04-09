import type { Tool } from '../_base.js';
import { browserFetch } from '../../services/browser-service.js';

export const browserFetchTool: Tool = {
    meta: { category: 'web', version: '1.0.0' },
    declaration: {
        name: 'browser_fetch',
        description:
            'Fetch a URL using a real Chrome browser with full JavaScript rendering. ' +
            'Use this when fetch_url fails (403, Cloudflare, login walls, SPA pages). ' +
            'Slower than fetch_url (~5-15s) but handles JS-heavy sites, paywalls, and anti-bot pages. ' +
            'Does NOT bypass sites that require user login (e.g. Twitter/X without session).',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)' },
                max_chars: {
                    type: 'number',
                    description: 'Maximum characters to return (default 8000, max 30000)',
                },
            },
            required: ['url'],
        },
    },
    handler: async (args) => {
        const url = String(args.url ?? '');
        const maxChars = Math.min(Number(args.max_chars ?? 8_000), 30_000);
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return '[Error] URL 必须以 http:// 或 https:// 开头';
        }
        return browserFetch(url, maxChars);
    },
};
