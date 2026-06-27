/**
 * src/llm/tool-error-classifier.ts — 集中式工具错误分类器。
 *
 * 工具失败时，给出结构化标签（type + retryable + suggestion），
 * 由 wrapExecute() 把它作为附加提示回灌给模型，模型据此决定是否重试。
 * 框架本身不做自动 backoff —— 与 tool-loop-guard 协同：
 *   - 本分类器回答“这次失败是什么性质、要不要重试”。
 *   - tool-loop-guard 回答“同一失败是否已重复太多次、需要强制短路”。
 *
 * 默认基于通用启发式（HTTP 状态码 / 权限 / 参数 / 网络 / 限流关键词）。
 * 工具可通过 `meta.classifyError` 声明按工具覆盖规则，优先于通用启发式。
 */

import type { Tool } from './types.js';

export type ToolErrorType = 'transient' | 'quota' | 'permanent' | 'validation' | 'unknown';

export interface ClassifiedError {
    type: ToolErrorType;
    /** 是否值得重试（语义判断，不代表框架会自动重试）。 */
    retryable: boolean;
    /** 给模型的下一步建议。 */
    suggestion: string;
}

/** 失败结果的常见前缀。工具错误多以 `[Error] ...` 表达。 */
const FAILURE_PREFIX = /^\s*\[Error\]/i;

/**
 * 判断一个工具结果是否表示失败。
 * 仅 `[Error]` 前缀视为确定失败；其它内容交给关键词启发式判断，
 * 避免把正常包含 "error" 字样的成功输出误判为失败。
 */
export function isFailureResult(result: unknown): boolean {
    return typeof result === 'string' && FAILURE_PREFIX.test(result);
}

const SUGGESTIONS: Record<ToolErrorType, string> = {
    transient:
        '临时性故障（网络 / 超时 / 服务暂时不可用）。可重试一次；若仍失败请换来源或基于已有信息回答。',
    quota:
        '触发限流或配额限制。短暂等待后可重试，或改用其它工具 / 来源；不要立即高频重试。',
    permanent:
        '永久性错误（鉴权 / 权限 / 资源不存在）。原样重试无意义，请改用其它工具、换凭证或换来源。',
    validation:
        '参数或请求格式非法。不要原样重试，请修正参数后再调用，或改用其它方式。',
    unknown:
        '未识别的失败。不建议原样重试，请换参数、换工具或基于已有信息直接回答。',
};

const RETRYABLE: Record<ToolErrorType, boolean> = {
    transient: true,
    quota: true,
    permanent: false,
    validation: false,
    unknown: false,
};

function classified(type: ToolErrorType): ClassifiedError {
    return { type, retryable: RETRYABLE[type], suggestion: SUGGESTIONS[type] };
}

/** 从文本里提取第一个 3 位 HTTP 状态码（紧跟 HTTP / status 上下文时优先）。 */
function extractHttpStatus(text: string): number | null {
    const labelled = text.match(/(?:HTTP|status(?:\s*code)?)[^\d]{0,8}(\d{3})/i);
    if (labelled) return Number(labelled[1]);
    return null;
}

function classifyByHttpStatus(status: number): ToolErrorType | null {
    if (status === 429) return 'quota';
    if (status === 401 || status === 403 || status === 404 || status === 410) return 'permanent';
    if (status === 400 || status === 422) return 'validation';
    if (status === 408 || status >= 500) return 'transient';
    return null;
}

/**
 * 通用启发式分类。输入应已确认为失败结果。
 */
function classifyByHeuristics(text: string): ToolErrorType {
    const lower = text.toLowerCase();

    const status = extractHttpStatus(text);
    if (status !== null) {
        const byStatus = classifyByHttpStatus(status);
        if (byStatus) return byStatus;
    }

    // 限流 / 配额（先于权限判断，避免 429 被误归类）。
    if (
        /rate.?limit|too many requests|quota|配额|额度|限流|频率过高/i.test(lower)
    ) {
        return 'quota';
    }

    // 权限 / 鉴权 / 资源不存在 —— 永久性。
    if (
        /unauthorized|forbidden|access denied|permission denied|invalid (?:api )?key|api key|not found|权限|鉴权|未授权|无权|拒绝访问|不存在/i.test(
            lower,
        )
    ) {
        return 'permanent';
    }

    // 参数 / 格式非法 —— validation。
    if (
        /invalid (?:argument|param|parameter|input|request|json)|bad request|malformed|schema|validation|must be|required|参数(?:非法|错误|缺失)|格式(?:非法|错误)|缺少必填/i.test(
            lower,
        )
    ) {
        return 'validation';
    }

    // 网络 / 超时 / 临时不可用 —— transient。
    if (
        /timeout|timed out|网络错误|网络|超时|temporarily|temporary|unavailable|econnreset|econnrefused|enotfound|etimedout|socket hang up|connection reset|连接(?:失败|超时|被重置)|暂时不可用/i.test(
            lower,
        )
    ) {
        return 'transient';
    }

    return 'unknown';
}

/**
 * 对工具结果做错误分类。
 *
 * @returns 失败时返回 ClassifiedError；非失败（成功或无法判定为失败）返回 null。
 */
export function classifyToolError(
    toolName: string,
    result: unknown,
    error?: unknown,
    tool?: Tool,
): ClassifiedError | null {
    // 1) 按工具覆盖优先。
    const override = tool?.meta?.classifyError;
    if (override) {
        try {
            const r = override(result, error);
            if (r) return r;
        } catch {
            // 覆盖规则抛错时回退到通用启发式。
        }
    }

    // 2) 组合可分类文本（工具结果 + 抛出的异常信息）。
    const parts: string[] = [];
    if (typeof result === 'string') parts.push(result);
    if (error instanceof Error) parts.push(error.message);
    else if (typeof error === 'string') parts.push(error);
    const text = parts.join('\n').trim();

    const hasThrown = error !== undefined && error !== null;
    if (!text) return hasThrown ? classified('unknown') : null;

    // 3) 仅在确定失败时分类。抛出异常一定是失败；否则要求 [Error] 前缀。
    if (!hasThrown && !isFailureResult(text)) return null;

    return classified(classifyByHeuristics(text));
}

/**
 * 把分类结果格式化成稳定、可解析的提示块，追加到 tool result 末尾。
 */
export function formatErrorHint(c: ClassifiedError): string {
    return `\n\n[ToolError] type=${c.type} retryable=${c.retryable}\nsuggestion: ${c.suggestion}`;
}

/** 从已注入提示块的结果字符串里解析出分类信息，用于可观测性。 */
export function parseErrorHint(result: string): Pick<ClassifiedError, 'type' | 'retryable'> | null {
    const m = result.match(/\[ToolError\]\s+type=(\w+)\s+retryable=(true|false)/);
    if (!m) return null;
    return {
        type: m[1] as ToolErrorType,
        retryable: m[2] === 'true',
    };
}
