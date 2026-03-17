import type { Tool } from './_base.js';

export const getDatetimeTool: Tool = {
    meta: { category: 'utility', version: '1.0.0' },
    declaration: {
        name: 'get_datetime',
        description:
            'Get the current date and time, optionally in a specific timezone. ' +
            'Use this to answer "what time is it now", check dates, or compare timezones.',
        parameters: {
            type: 'object',
            properties: {
                timezone: {
                    type: 'string',
                    description:
                        'IANA timezone identifier, e.g. "Asia/Shanghai", "America/New_York", "Europe/London", "UTC". ' +
                        'Defaults to system timezone.',
                },
                format: {
                    type: 'string',
                    description:
                        'Output format: "full" (default) = date + time + timezone, ' +
                        '"date" = date only, "time" = time only, "timestamp" = Unix ms',
                },
            },
        },
    },
    handler: async (args) => {
        const timezone = args.timezone ? String(args.timezone) : undefined;
        const format = String(args.format ?? 'full');

        try {
            const now = new Date();
            const opts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {};

            switch (format) {
                case 'date':
                    return now.toLocaleDateString('zh-CN', {
                        ...opts,
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                    });
                case 'time':
                    return now.toLocaleTimeString('zh-CN', {
                        ...opts,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    });
                case 'timestamp':
                    return String(now.getTime());
                default: {
                    const dateStr = now.toLocaleDateString('zh-CN', {
                        ...opts,
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                    });
                    const timeStr = now.toLocaleTimeString('zh-CN', {
                        ...opts,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    });
                    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
                    return `${dateStr} ${timeStr}（${tz}）`;
                }
            }
        } catch (err: unknown) {
            return `[Error] get_datetime: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
