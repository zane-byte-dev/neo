/**
 * src/tools/user-tools/loader.ts — Load user-defined tools from .tools/ directory.
 *
 * Scans {workDir}/.tools/{name}/tool.yaml, parses each into a Tool object
 * whose handler spawns the co-located run script.
 *
 * Directory layout:
 *   .tools/
 *     imagine/
 *       tool.yaml    — name, description, parameters, runtime config
 *       run.py       — executable script (stdin JSON, stdout JSON)
 */

import { readdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml, buildParameters, type YamlMap } from '../../utils/yaml.js';
import { findRunScript, runToolScript } from './runner.js';
import type { Tool, ToolContext, FunctionDeclaration } from '../../llm/types.js';

export interface UserToolDefinition {
    tool: Tool;
    /** Absolute path to the tool directory */
    toolDir: string;
    /** Absolute path to the run script */
    scriptPath: string;
    /** Runtime configuration from tool.yaml */
    config: {
        timeout?: number;
        env?: string[];
    };
}

/**
 * Parse a tool.yaml file into a FunctionDeclaration + runtime config.
 */
function parseToolYaml(yamlText: string, toolDir: string): {
    declaration: FunctionDeclaration;
    timeout?: number;
    env?: string[];
} {
    const yaml = parseYaml(yamlText);

    const name = String(yaml['name'] ?? '').trim();
    const description = String(yaml['description'] ?? '').trim();
    if (!name) throw new Error(`[UserTools] tool.yaml in ${toolDir} missing 'name'`);
    if (!description) throw new Error(`[UserTools] tool.yaml in ${toolDir} missing 'description'`);

    const paramsRaw = yaml['parameters'];
    const parameters = paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)
        ? buildParameters(paramsRaw as YamlMap)
        : { type: 'object', properties: {} };

    const timeout = yaml['timeout'] ? Number(yaml['timeout']) : undefined;
    const envRaw = yaml['env'];
    const env = Array.isArray(envRaw) ? envRaw as string[] : undefined;

    return {
        declaration: { name, description, parameters: parameters! },
        timeout,
        env,
    };
}

/**
 * Load all user tools from {workDir}/.tools/ directory.
 * Returns a Map<toolName, Tool> ready to be merged into the AI tool set.
 */
export async function loadUserTools(workDir: string): Promise<Map<string, Tool>> {
    const toolsDir = join(workDir, '.tools');
    const result = new Map<string, Tool>();

    let entries: import('node:fs').Dirent[];
    try {
        entries = await readdir(toolsDir, { withFileTypes: true });
    } catch {
        // .tools/ doesn't exist — that's fine, no user tools
        return result;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

        const toolDir = join(toolsDir, entry.name);
        const yamlPath = join(toolDir, 'tool.yaml');

        let yamlText: string;
        try {
            yamlText = await readFile(yamlPath, 'utf8');
        } catch {
            console.warn(`[UserTools] Skipped ${entry.name}: no tool.yaml`);
            continue;
        }

        if (!yamlText.trim()) {
            console.warn(`[UserTools] Skipped ${entry.name}: tool.yaml is empty`);
            continue;
        }

        const scriptPath = await findRunScript(toolDir);
        if (!scriptPath) {
            console.warn(`[UserTools] Skipped ${entry.name}: no run script (run.py/run.ts/run.js/run.sh)`);
            continue;
        }

        let parsed: ReturnType<typeof parseToolYaml>;
        try {
            parsed = parseToolYaml(yamlText, toolDir);
        } catch (err: unknown) {
            console.warn(`[UserTools] Skipped ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        const { declaration, timeout, env } = parsed;
        const capturedToolDir = toolDir;
        const capturedScriptPath = scriptPath;
        const capturedConfig = { timeout, env };

        const tool: Tool = {
            declaration,
            meta: { category: 'ai', version: '1.0.0' },
            handler: async (args: Record<string, unknown>, _workDir: string, context?: ToolContext) => {
                if (!context) return '[Error] User tool requires a context.';

                const scriptResult = await runToolScript(
                    capturedToolDir,
                    capturedScriptPath,
                    args,
                    context,
                    capturedConfig,
                );

                switch (scriptResult.type) {
                    case 'image':
                        if (scriptResult.data && context.imageCallback) {
                            await context.imageCallback(
                                scriptResult.data,
                                scriptResult.mimeType ?? 'image/png',
                                scriptResult.caption,
                            );
                            return scriptResult.caption
                                ? `[Image sent] ${scriptResult.caption}`
                                : '[Image sent] 图片已生成并发送。';
                        }
                        return scriptResult.content ?? '[Error] Image data missing from script output.';

                    case 'error':
                        return `[Error] ${scriptResult.content ?? 'Unknown error'}`;

                    case 'text':
                    default:
                        return scriptResult.content ?? '(no output)';
                }
            },
        };

        result.set(declaration.name, tool);
        console.log(`[UserTools] ✅ Loaded user tool: ${declaration.name} (${entry.name}/)`);
    }

    return result;
}
