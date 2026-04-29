/**
 * subagent.ts — Spawn a child agent for autonomous sub-tasks.
 *
 * The subagent runs non-streaming with a restricted tool subset and
 * returns its final text result to the parent agent.
 */

import type { Tool } from '../_base.js';
import { LLMClient, getToolRegistry } from '../../llm/client.js';
import { buildAiToolSubset } from '../../llm/ai-tools.js';
import { MAX_SUBAGENT_STEPS } from '../../config.js';
import { log } from '../../utils/logger.js';

/** Shared LLMClient instance for subagent calls. */
const llm = new LLMClient();

/** Tools that should never be delegated to a subagent */
const BLOCKED_TOOLS = new Set(['subagent', 'ask_user', 'enter_plan_mode', 'exit_plan_mode']);

export const subagent: Tool = {
    declaration: {
        name: 'subagent',
        description:
            'Spawn a child agent to handle a self-contained sub-task autonomously. ' +
            'The subagent runs with a restricted set of tools and returns a text result. ' +
            'Use this for research, analysis, or multi-step tasks that can run independently.',
        parameters: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'Detailed description of the task for the subagent to perform',
                },
                tools: {
                    type: 'string',
                    description:
                        'Comma-separated list of tool names the subagent may use (e.g. "read_file,bash,list_dir"). ' +
                        'Leave empty to grant all available tools (except subagent itself).',
                },
                context: {
                    type: 'string',
                    description: 'Additional context or background information for the subagent',
                },
                model: {
                    type: 'string',
                    description: 'Model alias to use (e.g. "flash", "pro"). Defaults to the parent model.',
                },
            },
            required: ['task'],
        },
    },

    async handler(args, workDir, ctx) {
        const task = String(args.task ?? '').trim();
        if (!task) return '[Error] task is required';

        const toolNames = String(args.tools ?? '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .filter(name => !BLOCKED_TOOLS.has(name));

        const contextInfo = String(args.context ?? '').trim();
        const modelAlias = String(args.model ?? '').trim() || undefined;

        // Build restricted tool set
        const registry = getToolRegistry();
        const toolSet = buildAiToolSubset(toolNames, registry, workDir, ctx);

        // Remove blocked tools from the set even if they slipped through
        for (const blocked of BLOCKED_TOOLS) {
            delete toolSet[blocked];
        }

        // Build prompt
        const parts: string[] = [];
        parts.push('You are a focused sub-agent. Complete the following task and return a concise result.');
        parts.push(`Working directory: ${workDir}`);
        if (contextInfo) parts.push(`Context: ${contextInfo}`);
        parts.push(`\nTask: ${task}`);

        const prompt = parts.join('\n');
        const availableToolNames = Object.keys(toolSet);
        const system = `You have access to these tools: ${availableToolNames.join(', ')}. ` +
            'Use them as needed. Be thorough but concise in your final answer.';

        log.info('Subagent', `Starting task with ${availableToolNames.length} tools: ${availableToolNames.join(', ')}`);

        const result = await llm.generateWithTools(prompt, toolSet, {
            model: modelAlias,
            system,
            maxSteps: MAX_SUBAGENT_STEPS,
        });

        if (!result) return '[Subagent] No result produced.';
        return `[Subagent Result]\n${result}`;
    },

    meta: {
        category: 'utility',
        version: '1.0.0',
        permission: 'dangerous',
    },
};
