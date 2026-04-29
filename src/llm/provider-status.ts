/**
 * src/llm/provider-status.ts — Lightweight runtime checks for whether a
 * model provider is actually usable on this machine.
 *
 * - gemini-cli: looks up GEMINI_CLI_PATH on PATH (or as an absolute path).
 * - ollama:     does a short HTTP GET against OLLAMA_BASE_URL.
 * - cloud:      already covered by isModelAliasAvailable() (API key present).
 */

import { access, constants } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { GEMINI_CLI_PATH, OLLAMA_BASE_URL } from '../config.js';
import { isAcpAvailable } from './providers/gemini-acp.js';

export interface ProviderStatus {
    /** Provider id used by the UI (matches resolveProvider() in routes/model.ts). */
    provider: 'google' | 'gemini-acp' | 'deepseek' | 'openai' | 'anthropic' | 'ollama';
    /** Whether the provider is usable right now. */
    ok: boolean;
    /** Short human-readable status (e.g. "running", "未安装 gemini CLI"). */
    detail?: string;
    /** Free-form structured info (e.g. detected version / endpoint). */
    meta?: Record<string, string | number | boolean | undefined>;
}

// ── gemini CLI ───────────────────────────────────────────────────────────────

async function isExecutable(p: string): Promise<boolean> {
    try {
        await access(p, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

let geminiCliCache: { ts: number; path: string | null } | null = null;
const GEMINI_CACHE_MS = 30_000;

/** Resolve the gemini CLI binary path (or null if not on PATH). */
export async function resolveGeminiCliPath(): Promise<string | null> {
    if (geminiCliCache && Date.now() - geminiCliCache.ts < GEMINI_CACHE_MS) {
        return geminiCliCache.path;
    }
    const target = GEMINI_CLI_PATH;
    let resolved: string | null = null;
    if (isAbsolute(target)) {
        if (await isExecutable(target)) resolved = target;
    } else {
        const PATH = process.env.PATH ?? '';
        for (const dir of PATH.split(delimiter)) {
            if (!dir) continue;
            const candidate = join(dir, target);
            if (await isExecutable(candidate)) {
                resolved = candidate;
                break;
            }
        }
    }
    geminiCliCache = { ts: Date.now(), path: resolved };
    return resolved;
}

export async function checkGeminiAcp(): Promise<ProviderStatus> {
    const path = await resolveGeminiCliPath();
    if (!path) {
        return {
            provider: 'gemini-acp',
            ok: false,
            detail: '未检测到 gemini CLI（请先 `npm i -g @google/gemini-cli` 并完成 OAuth 登录）',
            meta: { binary: GEMINI_CLI_PATH },
        };
    }
    return {
        provider: 'gemini-acp',
        ok: true,
        detail: isAcpAvailable() ? '已启动 ACP 会话' : '已安装，按需启动',
        meta: { binary: path, running: isAcpAvailable() },
    };
}

// ── Ollama ───────────────────────────────────────────────────────────────────

let ollamaCache: { ts: number; status: ProviderStatus } | null = null;
const OLLAMA_CACHE_MS = 10_000;

export async function checkOllama(): Promise<ProviderStatus> {
    if (ollamaCache && Date.now() - ollamaCache.ts < OLLAMA_CACHE_MS) {
        return ollamaCache.status;
    }
    // OLLAMA_BASE_URL is the OpenAI-compat endpoint (…/v1). The native API is at root.
    const base = OLLAMA_BASE_URL.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const tagsUrl = `${base}/api/tags`;
    let status: ProviderStatus;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(tagsUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) {
            status = {
                provider: 'ollama',
                ok: false,
                detail: `Ollama 响应异常 HTTP ${res.status}`,
                meta: { endpoint: base },
            };
        } else {
            const data = (await res.json().catch(() => ({}))) as { models?: Array<{ name: string }> };
            const count = Array.isArray(data.models) ? data.models.length : 0;
            status = {
                provider: 'ollama',
                ok: true,
                detail: count > 0 ? `运行中 · 已安装 ${count} 个模型` : '运行中（未发现已下载模型）',
                meta: { endpoint: base, modelCount: count },
            };
        }
    } catch (err) {
        status = {
            provider: 'ollama',
            ok: false,
            detail: `无法连接到 ${base}（请确认 ollama serve 已启动）`,
            meta: { endpoint: base, error: err instanceof Error ? err.message : String(err) },
        };
    }
    ollamaCache = { ts: Date.now(), status };
    return status;
}

// ── Aggregate ────────────────────────────────────────────────────────────────

import { getAnthropicApiKey, getDeepseekApiKey, getGeminiApiKey, getOpenAIApiKey } from '../config.js';

function cloudStatus(provider: ProviderStatus['provider'], hasKey: boolean): ProviderStatus {
    return {
        provider,
        ok: hasKey,
        detail: hasKey ? 'API Key 已配置' : '未配置 API Key',
    };
}

export async function getAllProviderStatus(): Promise<ProviderStatus[]> {
    const [acp, ollama] = await Promise.all([checkGeminiAcp(), checkOllama()]);
    return [
        cloudStatus('google', Boolean(getGeminiApiKey())),
        acp,
        cloudStatus('deepseek', Boolean(getDeepseekApiKey())),
        cloudStatus('openai', Boolean(getOpenAIApiKey())),
        cloudStatus('anthropic', Boolean(getAnthropicApiKey())),
        ollama,
    ];
}
