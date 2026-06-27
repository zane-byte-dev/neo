/**
 * skill-executor.ts — LLM Bridge for executing Skill definitions.
 *
 * Supports two execution modes:
 *
 *   1. Prompt mode (default)
 *      The skill's Markdown body is used as the system instruction.
 *      Parameters are interpolated with {{param_name}} syntax.
 *      A full agentLoop is run so the skill can call other tools.
 *
 *   2. Code block mode (when executableBlocks are present)
 *      The first executable block is written to a temp file and
 *      executed via Node.js (js/ts) or the appropriate runtime.
 *      Security: DANGEROUS_PATTERNS from tool-executor are enforced.
 */

import { tmpdir } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execa } from 'execa';
import { DANGEROUS_PATTERNS, MAX_TOOL_ITERATIONS } from '../config.js';
import { buildAiTools } from '../llm/ai-tools.js';
import { LLMClient } from '../llm/client.js';
import type { SkillDefinition } from './skill-parser.js';
import type { ToolContext } from '../llm/types.js';

const llm = new LLMClient();

// ── Interpolation ─────────────────────────────────────────────────────────────

/**
 * Replace {{param_name}} placeholders in a template with their values from args.
 * Unknown placeholders are left as-is.
 */
export function interpolate(template: string, args: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        if (key in args) return String(args[key] ?? '');
        return match; // preserve unknown placeholders
    });
}

// ── Parameter validation ──────────────────────────────────────────────────────

function validateArgs(skill: SkillDefinition, args: Record<string, unknown>): string | null {
    const required = skill.frontmatter.parameters?.required ?? [];
    const missing = required.filter(k => !(k in args) || args[k] === undefined || args[k] === null || args[k] === '');
    if (missing.length > 0) {
        return `[SkillExecutor] Missing required parameter(s) for skill "${skill.frontmatter.name}": ${missing.join(', ')}`;
    }
    return null;
}

// ── Code block execution ──────────────────────────────────────────────────────

const EXEC_TIMEOUT_MS = 30_000;

type SandboxResult = { stdout: string; stderr: string };

async function runCodeBlock(lang: string, code: string): Promise<SandboxResult> {
    // Security: check for dangerous patterns before running
    if (DANGEROUS_PATTERNS.some(p => p.test(code))) {
        throw new Error('[SkillExecutor] Executable block contains dangerous pattern — execution blocked');
    }

    // Determine runtime
    let runtime: string;
    let ext: string;

    switch (lang.toLowerCase()) {
        case 'js':
        case 'javascript':
            runtime = process.execPath; // node
            ext = '.js';
            break;
        case 'ts':
        case 'typescript':
            runtime = 'npx';
            ext = '.ts';
            break;
        case 'python':
        case 'py':
            runtime = 'python3';
            ext = '.py';
            break;
        case 'sh':
        case 'bash':
        case 'shell':
            runtime = 'sh';
            ext = '.sh';
            break;
        default:
            throw new Error(`[SkillExecutor] Unsupported executable block language: ${lang}`);
    }

    const id = randomBytes(6).toString('hex');
    const tmpFile = join(tmpdir(), `skill-exec-${id}${ext}`);

    try {
        await writeFile(tmpFile, code, 'utf-8');

        const cmdArgs: string[] =
            lang === 'ts' || lang === 'typescript'
                ? ['tsx', tmpFile]
                : [tmpFile];

        const { stdout, stderr } = await execa(runtime, cmdArgs, {
            timeout: EXEC_TIMEOUT_MS,
            reject: false,
        });

        return { stdout: stdout ?? '', stderr: stderr ?? '' };
    } finally {
        await unlink(tmpFile).catch(() => { /* best-effort cleanup */ });
    }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Execute a skill with the given arguments.
 *
 * @param skill    The parsed SkillDefinition to execute.
 * @param args     Caller-supplied parameters (matched against frontmatter.parameters).
 * @param context  ToolContext for the current tenant — used to thread agentLoop correctly.
 * @returns        The final text output from the skill.
 */
export async function executeSkill(
    skill: SkillDefinition,
    args: Record<string, unknown>,
    context: ToolContext,
): Promise<string> {
    // 1. Validate required parameters
    const validationError = validateArgs(skill, args);
    if (validationError) return validationError;

    // 2. Code block mode — if the skill has executable blocks, run the first one
    if (skill.executableBlocks.length > 0) {
        const block = skill.executableBlocks[0];
        const interpolatedCode = interpolate(block.code, args);
        try {
            const { stdout, stderr } = await runCodeBlock(block.lang, interpolatedCode);
            const lines: string[] = [];
            if (stdout.trim()) lines.push(stdout.trim());
            if (stderr.trim()) lines.push(`[stderr]\n${stderr.trim()}`);
            return lines.join('\n') || '(no output)';
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return `[SkillExecutor] Code block execution failed: ${msg}`;
        }
    }

    // 3. Prompt mode — interpolate body and run via LLMClient with tools
    const systemInstruction = interpolate(skill.body, args);
    const triggerMessage = buildTriggerMessage(args);

    const { getToolRegistry } = await import('../llm/client.js');
    const tools = buildAiTools(getToolRegistry(), context.workDir, context);

    const text = await llm.generateWithTools(triggerMessage, tools, {
        system: systemInstruction,
        temperature: 0.7,
        maxSteps: MAX_TOOL_ITERATIONS,
    });

    return text ?? '(no response)';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTriggerMessage(args: Record<string, unknown>): string {
    // Build a compact summary of args as the "user message" to start the loop
    const entries = Object.entries(args);
    if (entries.length === 0) return '请执行以上技能。';
    const paramLines = entries.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n');
    return `执行技能，参数如下：\n${paramLines}`;
}
