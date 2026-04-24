/**
 * notebook-chat.ts — Source-grounded chat for notebooks.
 *
 * Implements the NotebookLM-style conversation loop:
 *   1. User sends a message, optionally with a selection of active sources.
 *   2. We retrieve relevant passages from the selected sources (keyword-based
 *      ranking — no vector DB).
 *   3. The LLM is prompted to answer strictly based on those passages and
 *      cite them using 【N】 or 【N:title】 markers.
 *   4. We parse citation markers out of the reply and attach source metadata.
 *
 * Conversation state is persisted per-notebook in `.chat/history.jsonl`.
 */

import { LLMClient } from '../llm/client.js';
import { appendUsageRecord, estimateCost } from '../llm/cost.js';
import {
    nbListSources,
    nbGetSourceEntry,
    nbAppendChatMessage,
    nbReadChatHistory,
    nbGetConfig,
    type NotebookChatMessage,
    type SourceMeta,
} from './notebook-service.js';

const DEFAULT_CHAT_MODEL = 'gemma';
// Max chars of source context injected per turn
const MAX_CTX_CHARS = 40_000;
// Max per-passage length (one source chunk)
const PASSAGE_SIZE = 3_500;
// Max number of passages to keep
const MAX_PASSAGES = 10;
// Number of prior turns included from history
const HISTORY_TURNS = 8;

let _client: LLMClient | null = null;
function getClient(): LLMClient {
    if (!_client) _client = new LLMClient();
    return _client;
}

// ── Keyword extraction & ranking ─────────────────────────────────────────────

const STOPWORDS = new Set([
    '的', '了', '是', '和', '在', '有', '一', '这', '那', '我', '你', '他', '她', '它',
    '们', '就', '也', '都', '而', '或', '及', '与', '但', '又', '如', '如果', '怎么', '什么',
    '请', '帮', '帮我', '说说', '分析', '一下', '一点',
    'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'from',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'can', 'will', 'would', 'should', 'could',
    'what', 'when', 'where', 'why', 'how', 'which', 'who',
    'tell', 'me', 'about', 'please',
]);

function tokenize(text: string): string[] {
    // Tokenize: split on whitespace + punctuation; also extract 2-gram CJK runs
    const ascii = text.toLowerCase().split(/[^a-z0-9]+/g).filter(t => t && t.length > 1 && !STOPWORDS.has(t));
    const cjk: string[] = [];
    const cjkRuns = text.match(/[\u4e00-\u9fff]+/g) ?? [];
    for (const run of cjkRuns) {
        for (let i = 0; i < run.length - 1; i++) {
            const bigram = run.slice(i, i + 2);
            if (!STOPWORDS.has(bigram)) cjk.push(bigram);
        }
    }
    return [...ascii, ...cjk];
}

interface ScoredPassage {
    sourceId: string;
    title: string;
    text: string;
    score: number;
    position: number; // byte offset in source
}

/** Find the most relevant passages across all provided sources. */
function retrievePassages(
    query: string,
    sources: Array<{ id: string; title: string; content: string }>,
): ScoredPassage[] {
    const tokens = tokenize(query);
    if (!tokens.length) {
        // No usable query tokens — return the head of each source as a weak fallback.
        return sources.map((s, i) => ({
            sourceId: s.id,
            title: s.title,
            text: s.content.slice(0, PASSAGE_SIZE),
            score: 1 / (i + 1),
            position: 0,
        }));
    }

    const passages: ScoredPassage[] = [];

    for (const src of sources) {
        const content = src.content;
        if (!content) continue;

        // Split into ~chunks of ~PASSAGE_SIZE
        const chunkCount = Math.max(1, Math.ceil(content.length / PASSAGE_SIZE));
        for (let i = 0; i < chunkCount; i++) {
            const start = i * PASSAGE_SIZE;
            const end = Math.min(start + PASSAGE_SIZE + 300, content.length); // small overlap
            const chunk = content.slice(start, end);
            const lower = chunk.toLowerCase();

            let score = 0;
            for (const tk of tokens) {
                if (!tk) continue;
                let idx = 0;
                while ((idx = lower.indexOf(tk, idx)) !== -1) {
                    score += 1;
                    idx += tk.length;
                }
            }
            if (score === 0 && i === 0) score = 0.1; // include head of each source as a weak fallback
            if (score > 0) {
                passages.push({
                    sourceId: src.id,
                    title: src.title,
                    text: chunk,
                    score,
                    position: start,
                });
            }
        }
    }

    // Sort by score desc, keep top N
    passages.sort((a, b) => b.score - a.score);
    return passages.slice(0, MAX_PASSAGES);
}

// ── Prompt assembly ──────────────────────────────────────────────────────────

function loadSourceContents(
    workDir: string,
    notebook: string,
    selectedSourceIds?: string[],
): Array<{ id: string; title: string; content: string }> {
    const all: SourceMeta[] = nbListSources(workDir, notebook);
    const targets = selectedSourceIds?.length
        ? all.filter(s => selectedSourceIds.includes(s.id))
        : all;
    const results: Array<{ id: string; title: string; content: string }> = [];
    for (const s of targets) {
        const entry = nbGetSourceEntry(workDir, notebook, s.id);
        if (!entry?.content) continue;
        results.push({ id: s.id, title: s.title, content: entry.content });
    }
    return results;
}

function styleInstruction(config: ReturnType<typeof nbGetConfig>): string {
    const style = config.chatStyle ?? 'default';
    const length = config.answerLength ?? 'default';

    let styleLine = '';
    if (style === 'study-guide') {
        styleLine = '以教学的语气回答，注重概念拆解、层次递进，适合学习者理解。';
    } else if (style === 'custom' && config.customStyle) {
        styleLine = config.customStyle;
    } else {
        styleLine = '以清晰、客观、有条理的语气回答。';
    }

    let lengthLine = '';
    if (length === 'short') lengthLine = '回答应简洁扼要，3-5 句话。';
    else if (length === 'long') lengthLine = '回答可以详细展开，覆盖多个维度。';
    else lengthLine = '回答长度适中（一至三段）。';

    return `${styleLine} ${lengthLine}`;
}

function buildSystemPrompt(
    notebook: string,
    passages: ScoredPassage[],
    styleDirective: string,
    citationMode: 'strict' | 'mixed' = 'strict',
): string {
    // Group passages by source for cleaner citation numbers
    const seenIds: string[] = [];
    for (const p of passages) if (!seenIds.includes(p.sourceId)) seenIds.push(p.sourceId);

    let ctxTotal = 0;
    const lines: string[] = [];
    lines.push('你是笔记本 "' + notebook + '" 的源文档研究助手。');
    lines.push('');
    lines.push('【核心规则】');
    if (citationMode === 'mixed') {
        lines.push('1. 优先基于下方给出的来源段落回答。如果来源不足以完全回答问题，可以适当补充你的常识和知识，但必须明确区分。');
        lines.push('2. 来自来源的信息使用【N】标注。补充的常识部分不加引用标记，并可以在末尾简短说明"以上部分内容基于常识补充"。');
    } else {
        lines.push('1. 严格基于下方给出的来源段落回答，不得引用来源外的事实。');
        lines.push('2. 如果来源中没有相关信息，请如实回复："来源中没有相关信息"，不要编造。');
    }
    lines.push('3. 每当你引用某条来源的信息，请在句末用形如【N】的标记标注来源编号（N 为来源的数字编号）。');
    lines.push('4. 可以在一句话末尾叠加多个标记，如"……【1】【3】"。');
    lines.push(`5. 风格与长度：${styleDirective}`);
    lines.push('6. 不要输出"根据来源 N"之类的前缀 — 直接用【N】脚注形式即可。');
    lines.push('');
    lines.push('【来源段落】');
    for (let i = 0; i < seenIds.length; i++) {
        const sid = seenIds[i];
        const ps = passages.filter(p => p.sourceId === sid);
        const title = ps[0].title;
        lines.push(`\n━━ 来源 ${i + 1}: ${title} (id=${sid}) ━━`);
        for (const p of ps) {
            if (ctxTotal + p.text.length > MAX_CTX_CHARS) {
                lines.push('[... 剩余段落已截断 ...]');
                break;
            }
            lines.push(p.text);
            ctxTotal += p.text.length;
        }
        if (ctxTotal > MAX_CTX_CHARS) break;
    }
    return lines.join('\n');
}

// ── Citation parsing ─────────────────────────────────────────────────────────

export interface ParsedCitation {
    n: number;
    sourceId: string;
    title: string;
    snippet?: string;
}

function parseCitations(
    text: string,
    passages: ScoredPassage[],
): ParsedCitation[] {
    // Build an ordered list of unique source ids matching passage order used in the prompt
    const seen: string[] = [];
    for (const p of passages) if (!seen.includes(p.sourceId)) seen.push(p.sourceId);

    const cited = new Set<number>();
    for (const m of text.matchAll(/【\s*(\d+)(?:\s*[:：][^】]*)?\s*】/g)) {
        const n = Number(m[1]);
        if (n >= 1 && n <= seen.length) cited.add(n);
    }

    const results: ParsedCitation[] = [];
    for (const n of [...cited].sort((a, b) => a - b)) {
        const sid = seen[n - 1];
        const p = passages.find(pp => pp.sourceId === sid)!;
        results.push({
            n,
            sourceId: sid,
            title: p.title,
            snippet: p.text.slice(0, 200).trim(),
        });
    }
    return results;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface NotebookChatStreamEvent {
    type: 'text' | 'citations' | 'done' | 'error' | 'meta';
    text?: string;
    citations?: ParsedCitation[];
    /** meta: list of sources used for this turn */
    sources?: Array<{ n: number; sourceId: string; title: string }>;
    error?: string;
}

/**
 * Stream a notebook chat response. Callback receives incremental events.
 */
export async function streamNotebookChat(
    workDir: string,
    notebook: string,
    userMessage: string,
    selectedSourceIds: string[] | undefined,
    onEvent: (evt: NotebookChatStreamEvent) => void,
    signal?: AbortSignal,
    model?: string,
    userId?: string,
): Promise<NotebookChatMessage> {
    // 1. Persist user message
    const userEntry: NotebookChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: userMessage,
        selectedSources: selectedSourceIds,
        timestamp: Date.now(),
    };
    nbAppendChatMessage(workDir, notebook, userEntry);

    // 2. Build retrieval context
    const sources = loadSourceContents(workDir, notebook, selectedSourceIds);
    const passages = retrievePassages(userMessage, sources);

    // Emit meta (which sources/passages are in play) for UI
    const seenIds: string[] = [];
    for (const p of passages) if (!seenIds.includes(p.sourceId)) seenIds.push(p.sourceId);
    onEvent({
        type: 'meta',
        sources: seenIds.map((sid, i) => {
            const p = passages.find(pp => pp.sourceId === sid)!;
            return { n: i + 1, sourceId: sid, title: p.title };
        }),
    });

    // 3. Build history + prompt
    const config = nbGetConfig(workDir, notebook);
    const history = nbReadChatHistory(workDir, notebook);
    // Exclude the freshly-appended user message (it's the last one) — the prompt
    // supplies it separately.
    const priorHistory = history.slice(Math.max(0, history.length - 1 - HISTORY_TURNS), -1);
    const historyText = priorHistory.length
        ? priorHistory.map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n\n')
        : '';

    const systemPrompt = buildSystemPrompt(notebook, passages, styleInstruction(config), config.citationMode ?? 'strict');
    const fullPrompt = historyText
        ? `[之前的对话]\n${historyText}\n\n[新的问题]\n${userMessage}`
        : `[用户问题]\n${userMessage}`;

    // 4. Stream LLM response
    let assistantText = '';
    const startedAt = Date.now();
    try {
        // LLMClient.generate() is non-streaming. We simulate streaming by calling
        // generate then emitting the whole text. (A future pass can wire proper
        // streaming through a new client method that exposes fullStream for a
        // bare prompt without tools.)
        const out = await getClient().generateWithUsage(fullPrompt, {
            model: model || DEFAULT_CHAT_MODEL,
            system: systemPrompt,
            temperature: 0.4,
            userId,
            context: 'notebook-chat',
        });
        assistantText = (out?.text ?? '').trim();
        if (signal?.aborted) throw new Error('aborted');
        onEvent({ type: 'text', text: assistantText });
        if (out?.usage && userId) {
            void appendUsageRecord({
                timestamp: Date.now(),
                userId,
                model: out.model ?? (model || DEFAULT_CHAT_MODEL),
                tier: 'standard',
                score: 0,
                confidence: 1,
                reason: 'notebook-chat',
                promptTokens: out.usage.inputTokens ?? 0,
                completionTokens: out.usage.outputTokens ?? 0,
                totalTokens: out.usage.totalTokens ?? ((out.usage.inputTokens ?? 0) + (out.usage.outputTokens ?? 0)),
                estimatedCost: estimateCost(out.model ?? (model || DEFAULT_CHAT_MODEL), out.usage.inputTokens ?? 0, out.usage.outputTokens ?? 0),
                durationMs: Date.now() - startedAt,
                fallbackUsed: false,
                userPrompt: userMessage,
                systemPrompt,
            }, workDir).catch(() => { /* never crash over tracking */ });
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onEvent({ type: 'error', error: msg });
        throw err;
    }

    // 5. Parse citations
    const citations = parseCitations(assistantText, passages);
    onEvent({ type: 'citations', citations });

    // 6. Persist assistant message
    const assistantEntry: NotebookChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: assistantText,
        citations,
        timestamp: Date.now(),
    };
    nbAppendChatMessage(workDir, notebook, assistantEntry);

    onEvent({ type: 'done' });
    return assistantEntry;
}
