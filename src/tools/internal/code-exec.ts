import type { Tool } from '../_base.js';
import { runInRepl, type ReplLanguage } from '../../sandbox/repl-manager.js';

export const codeExecTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0', permission: 'dangerous' },
    declaration: {
        name: 'code_exec',
        description:
            'Execute Python or Node.js code in a persistent REPL session. ' +
            'Variables, imports, and function definitions from previous calls in the same conversation are preserved. ' +
            'Prefer this over `bash python -c "..."` for multi-step data work. ' +
            'Output is whatever is printed to stdout/stderr — wrap values in print()/console.log() to see them.',
        parameters: {
            type: 'object',
            properties: {
                language: {
                    type: 'string',
                    enum: ['python', 'node'],
                    description: 'Interpreter to use. Sessions are isolated per language.',
                },
                code: { type: 'string', description: 'Code to execute.' },
                timeout_ms: {
                    type: 'number',
                    description: 'Hard timeout in ms (default 60000, capped by SANDBOX_MAX_TIMEOUT_MS).',
                },
            },
            required: ['language', 'code'],
        },
    },
    handler: async (args, workDir, context) => {
        const language = (String(args.language) === 'node' ? 'node' : 'python') as ReplLanguage;
        const code = String(args.code ?? '');
        if (!code.trim()) return '(empty code)';
        if (!context?.userId || !context?.sessionId) {
            return '[Error] code_exec requires a session context.';
        }
        const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined;
        try {
            const res = await runInRepl({
                userId: context.userId,
                sessionId: context.sessionId,
                language,
                code,
                workDir,
                timeoutMs,
                signal: context.signal,
            });
            const parts: string[] = [];
            const out = res.stdout.trim();
            const err = res.stderr.trim();
            if (out) parts.push(out);
            if (err) parts.push(`[stderr]\n${err}`);
            if (res.timedOut) parts.push(`[TIMEOUT] REPL exceeded the time limit after ${res.durationMs}ms; session was reset.`);
            return parts.join('\n').trim() || '(no output)';
        } catch (e) {
            return `[Error] ${e instanceof Error ? e.message : String(e)}`;
        }
    },
};
