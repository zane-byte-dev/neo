import type { Tool } from './_base.js';

export const httpRequestTool: Tool = {
    meta: { category: 'web', version: '1.0.0' },
    declaration: {
        name: 'http_request',
        description:
            'Make an HTTP GET or POST request to any URL with optional custom headers and body. ' +
            'Useful for calling REST APIs, checking endpoints, or fetching JSON data.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The full URL to request' },
                method: { type: 'string', description: 'HTTP method: GET (default) or POST' },
                headers: {
                    type: 'string',
                    description: 'JSON string of request headers, e.g. {"Authorization":"Bearer token","Content-Type":"application/json"}',
                },
                body: { type: 'string', description: 'Request body string (for POST). JSON or plain text.' },
                max_response_chars: {
                    type: 'number',
                    description: 'Maximum response body characters to return (default 5000, max 20000)',
                },
            },
            required: ['url'],
        },
    },
    handler: async (args) => {
        const url = String(args.url ?? '');
        const method = String(args.method ?? 'GET').toUpperCase();
        const maxChars = Math.min(Number(args.max_response_chars ?? 5_000), 20_000);

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return '[Error] URL 必须以 http:// 或 https:// 开头';
        }

        const headersObj: Record<string, string> = { 'User-Agent': 'inkClaw/2.0' };
        if (args.headers) {
            try {
                Object.assign(headersObj, JSON.parse(String(args.headers)));
            } catch {
                return '[Error] headers 不是合法的 JSON 字符串';
            }
        }

        const fetchOptions: RequestInit = { method, headers: headersObj };
        if (args.body) {
            fetchOptions.body = String(args.body);
            if (!headersObj['Content-Type']) {
                try {
                    JSON.parse(String(args.body));
                    headersObj['Content-Type'] = 'application/json';
                } catch {
                    headersObj['Content-Type'] = 'text/plain';
                }
            }
        }

        try {
            const res = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(30_000) });
            const text = await res.text();
            const truncated =
                text.length > maxChars
                    ? text.slice(0, maxChars) + `\n[...已截断，还有 ${text.length - maxChars} 个字符]`
                    : text;
            return (
                `HTTP ${res.status} ${res.statusText}\n` +
                `Content-Type: ${res.headers.get('content-type') ?? 'unknown'}\n\n` +
                truncated
            );
        } catch (err: unknown) {
            return `[Error] http_request: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
