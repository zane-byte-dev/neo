import type { Tool } from '../_base.js';

/**
 * WMO Weather interpretation codes (WW)
 * https://open-meteo.com/en/docs
 */
const getWeatherDesc = (code: number) => {
    const table: Record<number, string> = {
        0: '晴朗', 1: '晴间多云', 2: '多云', 3: '阴天',
        45: '雾', 48: '沉积雾', 51: '细雨', 53: '中等细雨', 55: '浓密细雨',
        61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
        80: '阵雨', 81: '强阵雨', 82: '剧烈阵雨', 95: '雷雨'
    };
    return table[code] ?? '未知天气';
};

export const getWeatherTool: Tool = {
    meta: { category: 'utility', version: '3.1.0', permission: 'read' },
    declaration: {
        name: 'get_weather',
        description: '获取全球城市的天气。智能识别同名城市，优先返回主要大城市。',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: '城市名称，如 "杭州", "Tokyo", "London"。',
                },
                lang: {
                    type: 'string',
                    description: '语言: "zh" 为中文（默认）, "en" 为英文',
                },
            },
            required: ['location'],
        },
    },
    handler: async (args) => {
        const locationName = String(args.location ?? '');
        const lang = String(args.lang ?? 'zh');

        try {
            // 1. Geocoding: 请求 10 个结果以便筛选
            const geoRes = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=10&language=${lang === 'zh' ? 'zh' : 'en'}`
            );
            const geoData = (await geoRes.json()) as any;

            if (!geoData.results || geoData.results.length === 0) {
                return `[Error] 找不到城市 "${locationName}"。`;
            }

            // 2. 智能筛选：优先选择人口最多且行政级别高的结果（避免把杭州定位到四川山里）
            const results = geoData.results as any[];
            const city = results.sort((a, b) => {
                // 优先看人口
                const popA = a.population ?? 0;
                const popB = b.population ?? 0;
                if (Math.abs(popA - popB) > 100000) return popB - popA;
                // 人口接近时，看行政级别 (PPLA, PPLC 等)
                const rankA = (a.feature_code?.startsWith('PPLA') || a.feature_code === 'PPLC') ? 1 : 0;
                const rankB = (b.feature_code?.startsWith('PPLA') || b.feature_code === 'PPLC') ? 1 : 0;
                return rankB - rankA;
            })[0];

            const { latitude, longitude, name, admin1, country } = city;

            // 3. 获取天气
            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
            const weatherRes = await fetch(weatherUrl);
            const weatherData = (await weatherRes.json()) as any;

            const cur = weatherData.current;
            const daily = weatherData.daily;

            // 4. 格式化输出
            let out = `📍 **${name}** (${admin1 || ''}, ${country})\n\n`;
            out += `🌡️ 温度: **${cur.temperature_2m}°C** (体感 ${cur.apparent_temperature}°C)\n`;
            out += `☁️ 天气: ${getWeatherDesc(cur.weather_code)}\n`;
            out += `💧 湿度: ${cur.relative_humidity_2m}% | 🌬️ 风速: ${cur.wind_speed_10m} km/h\n`;

            if (daily) {
                out += '\n📅 **未来3天预报**:\n';
                for (let i = 0; i < 3; i++) {
                    const date = daily.time[i];
                    const min = daily.temperature_2m_min[i];
                    const max = daily.temperature_2m_max[i];
                    const desc = getWeatherDesc(daily.weather_code[i]);
                    out += `  ${date}: ${min}~${max}°C  ${desc}\n`;
                }
            }

            return out.trim();
        } catch (err: unknown) {
            return `[Error] 天气获取失败: ${err instanceof Error ? err.message : String(err)}`;
        }
    },
};
