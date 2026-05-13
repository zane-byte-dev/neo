/**
 * notebook-ai.ts — AI generation for NotebookLM-style features.
 *
 * Produces:
 *   - Source guide: summary + key topics + suggested questions
 *   - Notebook overview: synthesis across all selected sources
 *   - Mind map: hierarchical JSON tree (markmap-compatible markdown)
 *   - Report: FAQ / study-guide / briefing / timeline / outline / custom
 *   - Audio script: 2-speaker podcast-style dialogue
 *
 * All generations use non-streaming `LLMClient.generate()` and prefer the
 * ACP (free-quota) or Gemini model — falls back through the model router.
 */

import { LLMClient } from '../llm/client.js';
import {
    nbListSources,
    nbGetSourceEntry,
    nbSaveSourceGuide,
    nbSaveArtifact,
    nbSetConfig,
    nbGetConfig,
    sourceIdFromEntryId,
    type SourceGuide,
    type SourceMeta,
    type Artifact,
    type NotebookEntry,
} from './notebook-service.js';
import { parseJsonOr } from '../utils/json.js';

// Default model for non-tool generation — cheap & good at structured output.
const DEFAULT_MODEL = 'gemma';

// Max characters fed into a single generation prompt (budgeted context window)
const CTX_MAX = 60_000;
// Per-source slice cap when combining multiple sources
const PER_SOURCE_SLICE = 8_000;

let _client: LLMClient | null = null;
function getClient(): LLMClient {
    if (!_client) _client = new LLMClient();
    return _client;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadSourceContents(
    workDir: string,
    notebook: string,
    sourceIds: string[] | undefined,
): Array<{ id: string; title: string; content: string }> {
    const all = nbListSources(workDir, notebook);
    const targets = sourceIds?.length
        ? all.filter(s => sourceIds.includes(s.id))
        : all;

    const results: Array<{ id: string; title: string; content: string }> = [];
    for (const src of targets) {
        const entry = nbGetSourceEntry(workDir, notebook, src.id);
        if (!entry?.content) continue;
        results.push({
            id: src.id,
            title: src.title,
            content: entry.content.slice(0, PER_SOURCE_SLICE),
        });
    }
    return results;
}

function joinSourcesForPrompt(
    sources: Array<{ id: string; title: string; content: string }>,
    labelPrefix = '来源',
): string {
    let totalLen = 0;
    const parts: string[] = [];
    for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        const block = `[${labelPrefix} ${i + 1}: ${s.title}]\n${s.content}`;
        if (totalLen + block.length > CTX_MAX) {
            parts.push(`[... 已省略 ${sources.length - i} 条较长来源 ...]`);
            break;
        }
        totalLen += block.length;
        parts.push(block);
    }
    return parts.join('\n\n---\n\n');
}

function tryParseJson<T>(text: string): T | null {
    const cleaned = text
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();

    const objectStart = cleaned.indexOf('{');
    const arrayStart = cleaned.indexOf('[');
    const startIndex = [objectStart, arrayStart]
        .filter((index) => index !== -1)
        .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(startIndex)) return null;

    const body = cleaned.slice(startIndex);
    const parsed = parseJsonOr<T | null>(body, null);
    if (parsed !== null) return parsed;

    const endIndex = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    if (endIndex === -1) return null;

    return parseJsonOr<T | null>(body.slice(0, endIndex + 1), null);
}

// ── Source guide ─────────────────────────────────────────────────────────────

export async function generateSourceGuide(
    entry: NotebookEntry,
    model?: string,
): Promise<SourceGuide> {
    const content = (entry.content ?? '').slice(0, CTX_MAX);
    const prompt = `你在分析一份用户导入的来源文档，请严格以 JSON 输出（不要任何额外说明文字、不要代码围栏）：

{
  "summary": "一段 150-250 字的中文摘要",
  "keyTopics": ["主题1", "主题2", ...], // 5-8 个关键主题，每个 2-6 个字
  "suggestedQuestions": ["问题1", "问题2", ...] // 5 个用户可能想追问的问题
}

文档标题：${entry.title}

文档内容：
"""
${content}
"""`;

    const out = await getClient().generate(prompt, {
        model: model || DEFAULT_MODEL,
        temperature: 0.3,
    });
    const parsed = tryParseJson<{
        summary?: string;
        keyTopics?: string[];
        suggestedQuestions?: string[];
    }>(out ?? '');

    return {
        sourceId: sourceIdFromEntryId(entry.id),
        summary: parsed?.summary ?? ((entry.summary || '').slice(0, 400) || '暂无摘要。'),
        keyTopics: Array.isArray(parsed?.keyTopics) ? parsed.keyTopics.slice(0, 10) : [],
        suggestedQuestions: Array.isArray(parsed?.suggestedQuestions) ? parsed.suggestedQuestions.slice(0, 8) : [],
        generatedAt: Date.now(),
    };
}

/** Generate and persist a source guide. */
export async function generateAndSaveSourceGuide(
    workDir: string,
    notebook: string,
    entry: NotebookEntry,
    model?: string,
    stateDir = workDir,
): Promise<SourceGuide> {
    const guide = await generateSourceGuide(entry, model);
    nbSaveSourceGuide(workDir, notebook, guide, stateDir);
    return guide;
}

// ── Notebook overview ────────────────────────────────────────────────────────

export async function generateNotebookOverview(
    workDir: string,
    notebook: string,
    sourceIds?: string[],
    model?: string,
    stateDir = workDir,
): Promise<string> {
    const sources = loadSourceContents(workDir, notebook, sourceIds);
    if (!sources.length) return '';

    const joined = joinSourcesForPrompt(sources);
    const prompt = `以下是笔记本【${notebook}】中的来源文档集合。请用中文生成一段综合性的笔记本概览（200-400 字），说明这些来源覆盖的主要议题、关联与脉络。

${joined}

请直接输出概览正文，不需要标题或格式化前缀。`;

    const out = await getClient().generate(prompt, {
        model: model || DEFAULT_MODEL,
        temperature: 0.4,
        workDir,
    });
    const overview = (out ?? '').trim();

    // cache in notebook config
    const config = nbGetConfig(workDir, notebook, stateDir);
    nbSetConfig(workDir, notebook, { ...config, overview }, stateDir);
    return overview;
}

// ── Mind map ─────────────────────────────────────────────────────────────────

export interface MindMapNode {
    label: string;
    children?: MindMapNode[];
}

export async function generateMindMap(
    workDir: string,
    notebook: string,
    sourceIds: string[] | undefined,
    topic?: string,
    model?: string,
    stateDir = workDir,
    options?: { primaryArticleId?: string },
): Promise<Artifact> {
    const sources = loadSourceContents(workDir, notebook, sourceIds);
    const joined = sources.length ? joinSourcesForPrompt(sources) : '(无可用来源)';

    const prompt = `请基于以下来源文档生成一个思维导图。输出格式：纯 Markdown 标题层级（# / ## / ### / ####），不要代码围栏，不要额外说明。
- 根节点用 # ，是笔记本/主题的标题
- 二级主题用 ##
- 细分要点用 ### 或 ####
- 层级最多 4 层
- 标签简洁，每个 2-10 个字
${topic ? `- 重点围绕主题："${topic}"` : ''}

来源内容：
${joined}`;

    const out = await getClient().generate(prompt, {
        model: model || DEFAULT_MODEL,
        temperature: 0.4,
        workDir,
    });

    const markdown = (out ?? '').replace(/^\s*```(?:markdown)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    return nbSaveArtifact(workDir, notebook, {
        type: 'mindmap',
        title: topic ? `思维导图：${topic}` : `思维导图：${notebook}`,
        data: { markdown },
        sourceIds,
        primaryArticleId: options?.primaryArticleId,
    }, stateDir);
}

// ── Reports ──────────────────────────────────────────────────────────────────

export type ReportType = 'faq' | 'study-guide' | 'briefing' | 'timeline' | 'outline' | 'custom';

const REPORT_PROMPTS: Record<ReportType, string> = {
    faq: `请基于来源生成一份「常见问题解答 (FAQ)」，包含 10-15 个用户可能关心的问题，每题配一段简洁明确的回答。用 Markdown 格式输出，每个问题用 ### 标题。`,
    'study-guide': `请基于来源生成一份「学习指南」。包括：
## 核心概念
(列出 5-10 个核心概念，每个用加粗名词 + 一句解释)
## 术语表
(按字母或主题排序的关键词解释)
## 复习问题
(8-12 个思考题，由浅入深)
## 延伸探究
(3-5 个可进一步深入的方向)`,
    briefing: `请基于来源生成一份「简报文档」。结构：
## 执行摘要
(100 字以内的核心结论)
## 关键发现
(5-8 条，每条一行)
## 详细分析
(分 2-4 个小节展开)
## 建议行动
(3-5 条可执行建议)`,
    timeline: `请基于来源生成一份「时间线」，按时间顺序列出关键事件。用 Markdown 列表格式：
- **YYYY-MM-DD / YYYY / 某时期**：事件描述（1-2 行）

如果来源内没有明确时间信息，请尽可能根据上下文推断相对顺序，并在时间处注明「约」。`,
    outline: `请基于来源生成一份层级清晰的「主题大纲」，用 Markdown 多级列表表示，最多 4 层。每个条目简短精炼。`,
    custom: '', // provided by user
};

export async function generateReport(
    workDir: string,
    notebook: string,
    type: ReportType,
    options?: { sourceIds?: string[]; customPrompt?: string; title?: string; model?: string; primaryArticleId?: string },
    stateDir = workDir,
): Promise<Artifact> {
    const sources = loadSourceContents(workDir, notebook, options?.sourceIds);
    const joined = sources.length ? joinSourcesForPrompt(sources) : '(无可用来源)';

    const instruction = type === 'custom'
        ? (options?.customPrompt ?? '请基于来源生成一份结构化报告。')
        : REPORT_PROMPTS[type];

    const prompt = `${instruction}

输出要求：
- 使用 Markdown 格式
- 尽量引用来源中的事实；如来源缺少相关信息，请明确写出"来源中未提供"
- 不要输出代码围栏

来源内容：
${joined}`;

    const out = await getClient().generate(prompt, {
        model: options?.model || DEFAULT_MODEL,
        temperature: 0.5,
        workDir,
    });
    const markdown = (out ?? '').replace(/^\s*```(?:markdown)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    const titleMap: Record<ReportType, string> = {
        faq: '常见问题解答',
        'study-guide': '学习指南',
        briefing: '简报',
        timeline: '时间线',
        outline: '大纲',
        custom: '自定义报告',
    };

    return nbSaveArtifact(workDir, notebook, {
        type: 'report',
        subtype: type,
        title: options?.title || `${titleMap[type]}：${notebook}`,
        data: { markdown },
        sourceIds: options?.sourceIds,
        primaryArticleId: options?.primaryArticleId,
    }, stateDir);
}

// ── Audio script (podcast-style dialogue) ────────────────────────────────────

export interface AudioSegment {
    speaker: 'A' | 'B';
    text: string;
}

export async function generateAudioScript(
    workDir: string,
    notebook: string,
    sourceIds?: string[],
    model?: string,
    stateDir = workDir,
    options?: { primaryArticleId?: string },
): Promise<Artifact> {
    const sources = loadSourceContents(workDir, notebook, sourceIds);
    const joined = sources.length ? joinSourcesForPrompt(sources) : '(无可用来源)';

    const prompt = `你是一位播客节目编剧。基于以下来源，写一段 5-10 分钟、通俗易懂、引人入胜的双人对话脚本，适合配音朗读。

要求：
- 两个角色：A 是主持人（好奇、承上启下），B 是专家嘉宾（提供事实与分析）
- 覆盖来源中的关键要点；避免杜撰来源外的事实
- 每段台词 1-3 句；整体节奏明快；可以有适度的类比与举例
- 以主持人的开场白开始，以主持人的收束结尾

严格以 JSON 数组输出（不要任何说明文字、不要代码围栏）：

[
  {"speaker": "A", "text": "欢迎来到..."},
  {"speaker": "B", "text": "..."},
  ...
]

来源内容：
${joined}`;

    const out = await getClient().generate(prompt, {
        model: model || DEFAULT_MODEL,
        temperature: 0.7,
        workDir,
    });

    const parsed = tryParseJson<AudioSegment[]>(out ?? '');
    const segments: AudioSegment[] = Array.isArray(parsed)
        ? parsed
            .filter(s => s && (s.speaker === 'A' || s.speaker === 'B') && typeof s.text === 'string' && s.text.trim())
            .map(s => ({ speaker: s.speaker, text: s.text.trim() }))
        : [];

    const fallback = segments.length === 0 && out
        ? [{ speaker: 'A' as const, text: out.trim().slice(0, 2000) }]
        : segments;

    return nbSaveArtifact(workDir, notebook, {
        type: 'audio',
        title: `音频概览：${notebook}`,
        data: { script: fallback },
        sourceIds,
        primaryArticleId: options?.primaryArticleId,
    }, stateDir);
}

// ── Notes quick actions ──────────────────────────────────────────────────────

export type NoteQuickAction = 'merge' | 'outline' | 'feedback' | 'study-guide';

export async function runNoteQuickAction(
    action: NoteQuickAction,
    notes: Array<{ title: string; content: string }>,
    model?: string,
): Promise<string> {
    if (!notes.length) return '';
    const joined = notes
        .map((n, i) => `[笔记 ${i + 1}: ${n.title}]\n${n.content}`)
        .join('\n\n---\n\n')
        .slice(0, CTX_MAX);

    const prompts: Record<NoteQuickAction, string> = {
        merge: `请将以下多条笔记合并为一条结构清晰、没有重复的笔记。保留所有独特信息，按主题分组。用 Markdown 输出：\n\n${joined}`,
        outline: `请把以下笔记整理成一份层级大纲（Markdown 多级列表）：\n\n${joined}`,
        feedback: `请以建设性的语气，对以下笔记提供 3-5 条修改建议（聚焦清晰度、论证、结构）。用 Markdown 列表：\n\n${joined}`,
        'study-guide': `请基于以下笔记生成一份学习指南，包含核心概念、术语表、复习问题：\n\n${joined}`,
    };

    const out = await getClient().generate(prompts[action], {
        model: model || DEFAULT_MODEL,
        temperature: 0.5,
    });
    return (out ?? '').trim();
}

// ── Source list helper (re-export for route convenience) ─────────────────────

export type { SourceMeta };
