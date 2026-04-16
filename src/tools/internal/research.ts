/**
 * research.ts — Deep research tool that orchestrates multi-step web research.
 *
 * Searches the web for a given topic, fetches and reads multiple sources,
 * then uses the LLM to synthesize a comprehensive research report with citations.
 *
 * Relies on the existing search_web and fetch_url tools internally, and
 * uses a subagent-style LLM call to produce the final synthesis.
 */

import type { Tool, ToolContext } from '../_base.js';
import { LLMClient, getToolRegistry } from '../../llm/client.js';
import { buildAiToolSubset } from '../../llm/ai-tools.js';

/** Shared LLMClient instance for research synthesis. */
const llm = new LLMClient();

/** Default maximum number of agentic steps for research. */
const RESEARCH_MAX_STEPS = 15;

/** Tools allowed for the research subagent. */
const ALLOWED_TOOLS = ['search_web', 'fetch_url'];

export const researchTool: Tool = {
    meta: { category: 'web', version: '1.0.0' },
    declaration: {
        name: 'research',
        description:
            '对指定主题进行深度网络调研。自动搜索多个来源、阅读网页内容，最终输出带引用来源的综合研究报告。\n' +
            '适用场景：技术调研、市场分析、竞品调查、文献综述、事实核查等。',
        parameters: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: '要调研的主题或问题',
                },
                depth: {
                    type: 'string',
                    description:
                        '调研深度: "quick"（快速，1-2次搜索）或 "deep"（深入，多轮搜索+多源交叉验证）。默认 "quick"',
                },
                language: {
                    type: 'string',
                    description: '报告输出语言，如 "中文"、"English"。默认 "中文"',
                },
            },
            required: ['topic'],
        },
    },

    async handler(args, workDir, ctx) {
        const topic = String(args.topic ?? '').trim();
        if (!topic) return '[research] Missing required parameter: topic';

        const depth = String(args.depth ?? 'quick').trim().toLowerCase();
        const language = String(args.language ?? '中文').trim();

        const isDeep = depth === 'deep';

        // Build restricted tool set with only web tools
        const registry = getToolRegistry();
        const toolSet = buildAiToolSubset(ALLOWED_TOOLS, registry, workDir, ctx);

        const system = buildResearchSystemPrompt(language, isDeep);
        const prompt = buildResearchPrompt(topic, language, isDeep);

        const maxSteps = isDeep ? RESEARCH_MAX_STEPS : 8;

        console.log(`[Research] Starting ${isDeep ? 'deep' : 'quick'} research on: ${topic}`);

        const result = await llm.generateWithTools(prompt, toolSet, {
            system,
            maxSteps,
        });

        if (!result) return '[research] 调研未能生成结果，请稍后重试。';

        return result;
    },
};

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildResearchSystemPrompt(language: string, isDeep: boolean): string {
    const depthInstructions = isDeep
        ? `你需要进行深入调研：
- 进行多轮搜索，从不同角度和关键词搜索（至少 3-4 次搜索）
- 打开并阅读多个来源的内容（至少 3-5 个网页）
- 交叉验证不同来源的信息
- 注意区分事实与观点
- 关注最新和最权威的来源`
        : `你需要进行快速调研：
- 进行 1-2 次有针对性的搜索
- 阅读 2-3 个最相关的来源
- 提取核心信息并快速整合`;

    return `你是一个专业的研究助手。你的任务是对给定主题进行网络调研，并生成结构化的研究报告。

${depthInstructions}

## 工具使用指南

你可以使用以下工具：
- **search_web**: 搜索网络获取相关结果
- **fetch_url**: 打开具体网页，获取详细内容

## 调研流程

1. **搜索阶段**：使用 search_web 搜索相关信息
2. **阅读阶段**：用 fetch_url 打开最相关的搜索结果，阅读详细内容
3. **综合阶段**：整合所有收集的信息，生成结构化报告

## 报告格式要求

最终报告请用${language}输出，格式如下：

### 📋 研究报告：[主题]

**摘要**
（2-3句话概括核心发现）

**主要发现**
1. （发现1）
2. （发现2）
...

**详细分析**
（根据主题组织的详细内容，可分小节）

**引用来源**
1. [来源标题](URL)
2. [来源标题](URL)
...

## 注意事项
- 确保信息准确，有据可查
- 明确标注信息来源
- 区分确定事实和不确定推测
- 如果信息不足或矛盾，明确指出`;
}

function buildResearchPrompt(topic: string, language: string, isDeep: boolean): string {
    const depthLabel = isDeep ? '深入' : '快速';
    return `请对以下主题进行${depthLabel}调研，并用${language}生成研究报告：

主题：${topic}

请开始调研。先搜索相关信息，然后阅读重要来源，最后整合为结构化报告。`;
}
