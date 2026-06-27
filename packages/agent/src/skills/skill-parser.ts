/**
 * skill-parser.ts — Parses .skill.md files into SkillDefinition objects.
 *
 * File format:
 *   ---
 *   name: my_skill
 *   description: What this skill does
 *   parameters:
 *     type: object
 *     properties:
 *       param1:
 *         type: string
 *         description: ...
 *     required:
 *       - param1
 *   ---
 *
 *   Prompt body with {{param1}} interpolation slots.
 *
 *   ```js execute
 *   // optional code block — extracted and run in sandbox
 *   console.log("hello");
 *   ```
 */

import type { FunctionDeclaration } from '../llm/types.js';
import { parseYaml, buildParameters, type YamlMap } from '../utils/yaml.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
    name: string;
    description: string;
    parameters?: FunctionDeclaration['parameters'];
    version?: string;
    tags?: string[];
    /** Set to false to skip registration (default: true) */
    enabled?: boolean;
}

export interface SkillDefinition {
    frontmatter: SkillFrontmatter;
    /** Prompt template — may contain {{param_name}} placeholders */
    body: string;
    /** Code blocks marked with ```js execute (or ```python execute, etc.) */
    executableBlocks: Array<{ lang: string; code: string }>;
    /** Absolute path to the source .skill.md file */
    filePath: string;
}

function yamlToFrontmatter(yaml: YamlMap): SkillFrontmatter {
    const name = String(yaml['name'] ?? '').trim();
    const description = String(yaml['description'] ?? '').trim();

    if (!name) throw new Error('[SkillParser] Frontmatter missing required field: name');
    if (!description) throw new Error('[SkillParser] Frontmatter missing required field: description');

    const tags = Array.isArray(yaml['tags']) ? yaml['tags'] as string[] : undefined;
    const version = yaml['version'] ? String(yaml['version']) : undefined;
    const enabledRaw = yaml['enabled'];
    const enabled = enabledRaw === undefined ? undefined : String(enabledRaw) !== 'false';

    const paramsRaw = yaml['parameters'];
    const parameters =
        paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)
            ? buildParameters(paramsRaw as YamlMap)
            : undefined;

    return {
        name,
        description,
        parameters,
        ...(version ? { version } : {}),
        ...(tags ? { tags } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
    };
}

// ── Code block extractor ──────────────────────────────────────────────────────

const EXEC_BLOCK_RE = /^```(\w+)\s+execute\s*$/;

function extractExecutableBlocks(body: string): Array<{ lang: string; code: string }> {
    const lines = body.split('\n');
    const blocks: Array<{ lang: string; code: string }> = [];
    let inBlock = false;
    let lang = '';
    let codeLines: string[] = [];

    for (const line of lines) {
        if (!inBlock) {
            const match = line.match(EXEC_BLOCK_RE);
            if (match) {
                inBlock = true;
                lang = match[1];
                codeLines = [];
            }
        } else {
            if (line.trimEnd() === '```') {
                blocks.push({ lang, code: codeLines.join('\n') });
                inBlock = false;
                lang = '';
                codeLines = [];
            } else {
                codeLines.push(line);
            }
        }
    }

    return blocks;
}

// ── Main parser ───────────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/**
 * Parse a .skill.md file content into a SkillDefinition.
 * Throws if frontmatter is missing or malformed.
 */
export function parseSkillFile(content: string, filePath: string): SkillDefinition {
    const match = content.match(FRONTMATTER_RE);
    if (!match) {
        throw new Error(`[SkillParser] No frontmatter found in ${filePath}`);
    }

    const yamlText = match[1];
    const body = match[2].trim();

    let yamlMap: YamlMap;
    try {
        yamlMap = parseYaml(yamlText);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[SkillParser] YAML parse error in ${filePath}: ${msg}`);
    }

    const frontmatter = yamlToFrontmatter(yamlMap);
    const executableBlocks = extractExecutableBlocks(body);

    return { frontmatter, body, executableBlocks, filePath };
}
