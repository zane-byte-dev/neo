/**
 * plan-mode.ts — Plan mode tools: enter_plan_mode & exit_plan_mode.
 *
 * Plan mode restricts the agent to read-only tools so it can research and
 * reason about a problem before committing to changes.  Write-capable tools
 * (bash, write_file, etc.) are filtered out in ai-tools.ts when
 * context.mode === 'plan'.
 */

import type { Tool } from '../_base.js';

export const enter_plan_mode: Tool = {
    declaration: {
        name: 'enter_plan_mode',
        description:
            'Switch to plan mode. In plan mode you can only use read-only tools (read_file, list_dir, search, etc.) ' +
            'to research and analyze. Write tools (bash, write_file) are disabled. ' +
            'Use this before making complex changes to first understand the codebase.',
        parameters: {
            type: 'object',
            properties: {
                goal: {
                    type: 'string',
                    description: 'What you intend to research or plan for',
                },
            },
            required: ['goal'],
        },
    },

    async handler(args, _workDir, ctx) {
        const goal = String(args.goal ?? '').trim();
        if (!goal) return '[Error] goal is required';

        if (ctx) ctx.mode = 'plan';

        return [
            '🔍 Plan mode activated.',
            `Goal: ${goal}`,
            '',
            'You are now in read-only mode. Write tools (bash, write_file, edit_file) are disabled.',
            'Use read_file, list_dir, and other read-only tools to research.',
            'When you have a plan, call exit_plan_mode with your plan summary to switch back to normal mode.',
        ].join('\n');
    },

    meta: {
        category: 'utility',
        version: '1.0.0',
        permission: 'read',
    },
};

export const exit_plan_mode: Tool = {
    declaration: {
        name: 'exit_plan_mode',
        description:
            'Exit plan mode and return to normal execution mode. ' +
            'Provide a summary of your plan / findings from the research phase.',
        parameters: {
            type: 'object',
            properties: {
                plan: {
                    type: 'string',
                    description: 'Summary of the plan or findings from the research phase',
                },
            },
            required: ['plan'],
        },
    },

    async handler(args, _workDir, ctx) {
        const plan = String(args.plan ?? '').trim();
        if (!plan) return '[Error] plan summary is required';

        if (ctx) ctx.mode = 'normal';

        return [
            '✅ Exited plan mode. Normal execution restored — all tools are available.',
            '',
            '📋 Plan:',
            plan,
        ].join('\n');
    },

    meta: {
        category: 'utility',
        version: '1.0.0',
    },
};
