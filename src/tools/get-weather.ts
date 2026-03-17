import type { Tool } from './_base.js';

export const getWeatherTool: Tool = {
    meta: { category: 'utility', version: '1.0.0' },
    declaration: {
        name: 'get_weather',
        description:
            'Get current weather conditions and a 3-day forecast for any city. ' +
            'No API key required. Returns temperature, humidity, wind, UV index, and daily forecast.',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'City name or "city,country" (e.g., "Beijing", "Shanghai", "London,UK", "Tokyo,Japan")',
                },
                lang: {
                    type: 'string',
                    description: 'Language: "zh" for Chinese (default), "en" for English',
                },
            },
            required: ['location'],
        },
    },
    handler: async (args) => {
        const location = String(args.location ?? '');
        const lang = String(args.lang ?? 'zh');
        const langParam = lang === 'en' ? 'en' : 'zh-tw';

        try {
            const res = await fetch(
                `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=${langParam}`,
                { headers: { 'User-Agent': 'curl/7.68.0', Accept: 'application/json' } },
            );
            if (!res.ok) return `[Error] 天气获取失败: HTTP ${res.status}`;

            const data = await res.json() as any;
            const cur = data.current_condition?.[0];
            const area = data.nearest_area?.[0];
            if (!cur) return '[Error] 未返回天气数据';

            const city = area?.areaName?.[0]?.value ?? location;
            const country = area?.country?.[0]?.value ?? '';
            const desc = cur.lang_zh?.[0]?.value ?? cur.weatherDesc?.[0]?.value ?? '';

            let out = `📍 **${city}${country ? ', ' + country : ''}** 当前天气\n\n`;
            out += `🌡️ 温度: **${cur.temp_C}°C**（体感 ${cur.FeelsLikeC}°C）\n`;
            out += `☁️ 天气: ${desc}\n`;
            out += `💧 湿度: ${cur.humidity}%\n`;
            out += `🌬️ 风速: ${cur.windspeedKmph} km/h ${cur.winddir16Point}\n`;
            out += `👁️ 能见度: ${cur.visibility} km\n`;
            out += `☀️ 紫外线指数: ${cur.uvIndex}\n`;

            const forecast: any[] = data.weather?.slice(0, 3) ?? [];
            if (forecast.length > 0) {
                out += '\n📅 **未来3天预报**:\n';
                for (const day of forecast) {
                    const dayDesc =
                        day.hourly?.[4]?.lang_zh?.[0]?.value ??
                        day.hourly?.[4]?.weatherDesc?.[0]?.value ?? '';
                    out += `  ${day.date}: ${day.mintempC}~${day.maxtempC}°C  ${dayDesc}\n`;
                }
            }

            return out.trim();
        } catch (err: unknown) {
            return `[Error] get_weather: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
