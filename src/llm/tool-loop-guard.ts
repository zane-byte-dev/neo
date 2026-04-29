/**
 * src/llm/tool-loop-guard.ts — 防止 LLM 在同一 tool 上反复失败而不切换策略。
 *
 * 在一次 chatWithContextStreaming 调用范围内（每次 buildAiTools 创建一个新实例），
 * 按 toolName 维护“连续失败签名队列”。当某个 tool 连续返回 N 次同类型失败结果后，
 * 后续调用会被短路，直接返回一段强提示，要求模型切换来源或停止重复调用。
 *
 * 当前覆盖：
 *   - search_web：返回 `[Info] ... 暂无搜索结果` 视为失败
 *   - fetch_url：返回 `[Error] ...` / `HTTP <code>` / `网络错误` 视为失败
 */

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_REMEMBERED_QUERIES = 6;

export interface ToolLoopGuard {
    /** 命中循环时返回短路文本，否则返回 null。应在 execute() 之前调用。 */
    shortCircuit(toolName: string, args: Record<string, unknown>): string | null;
    /** execute() 返回后调用，记录本次结果是否属于失败签名。 */
    record(toolName: string, args: Record<string, unknown>, result: string): void;
}

interface Track {
    sigs: string[];
    queries: string[];
}

function failureSignature(toolName: string, result: string): string | null {
    if (typeof result !== 'string') return null;
    const head = result.slice(0, 200);

    if (toolName === 'search_web') {
        if (/^\[Info\][^\n]*暂无搜索结果/.test(head)) return 'no_results';
        if (/^\[Error\][^\n]*所有搜索引擎均不可用/.test(head)) return 'engines_down';
        return null;
    }

    if (toolName === 'fetch_url') {
        const httpMatch = head.match(/^\[Error\] HTTP (\d+|网络错误)/);
        if (httpMatch) return `http_${httpMatch[1]}`;
        if (/^\[Error\] fetch_url/.test(head)) return 'fetch_error';
        if (/^\[Error\][^\n]*Google Cache 和 Wayback Machine 均无法获取/.test(head)) return 'all_mirrors_failed';
        return null;
    }

    return null;
}

function describeQuery(toolName: string, args: Record<string, unknown>): string {
    if (toolName === 'search_web') return String(args?.query ?? '');
    if (toolName === 'fetch_url') return String(args?.url ?? '');
    try {
        return JSON.stringify(args).slice(0, 200);
    } catch {
        return '';
    }
}

function buildShortCircuitMessage(toolName: string, track: Track): string {
    const tried = track.queries
        .slice(-MAX_REMEMBERED_QUERIES)
        .map((q, i) => `  ${i + 1}. ${q}`)
        .join('\n');

    if (toolName === 'search_web') {
        return (
            `[Stop] 你已连续 ${track.sigs.length} 次调用 search_web 但全部没有结果。已尝试的查询：\n${tried}\n\n` +
            `不要再调用 search_web 重复或近义改写查询。请改用以下任一策略：\n` +
            `  1) 用 fetch_url 直接访问已知来源的 URL（如 https://www.reddit.com/r/ChatGPT/、https://news.ycombinator.com/、https://www.scientificamerican.com/ 等）；\n` +
            `  2) 基于本会话已收集到的信息直接回答用户，并明确指出哪些细节暂时无法核实。\n`
        );
    }

    if (toolName === 'fetch_url') {
        return (
            `[Stop] 你已连续 ${track.sigs.length} 次调用 fetch_url 但全部失败。已尝试的 URL：\n${tried}\n\n` +
            `不要再 fetch 同一来源或同一域名。请改用以下任一策略：\n` +
            `  1) 换一个完全不同的来源或域名（不同网站、不同语言版本、镜像站等）；\n` +
            `  2) 基于已收集到的信息直接回答用户，并明确指出哪些细节暂时无法核实。\n`
        );
    }

    return `[Stop] 工具 ${toolName} 已连续失败 ${track.sigs.length} 次，请改用其它方式或基于已有信息直接回答。`;
}

export function createToolLoopGuard(): ToolLoopGuard {
    const tracks = new Map<string, Track>();

    return {
        shortCircuit(toolName, args) {
            const t = tracks.get(toolName);
            if (!t || t.sigs.length < MAX_CONSECUTIVE_FAILURES) return null;
            // 仍然记录此次被短路的 query，便于下次提示
            const q = describeQuery(toolName, args);
            if (q) t.queries.push(q);
            return buildShortCircuitMessage(toolName, t);
        },
        record(toolName, args, result) {
            const sig = failureSignature(toolName, result);
            if (!sig) {
                tracks.delete(toolName);
                return;
            }
            const existing = tracks.get(toolName);
            const next: Track = existing ?? { sigs: [], queries: [] };
            next.sigs.push(sig);
            const q = describeQuery(toolName, args);
            if (q) next.queries.push(q);
            tracks.set(toolName, next);
        },
    };
}
