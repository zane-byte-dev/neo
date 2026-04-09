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

import type { FunctionDeclaration } from '../utils/gemini-types.js';

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

// ── Mini YAML parser ──────────────────────────────────────────────────────────
// Supports the subset of YAML needed by SkillFrontmatter:
//  - top-level key: scalar
//  - nested mappings (parameters, properties, items with 2-space indent)
//  - inline sequences with "- value"
//  - no anchors, no multiline scalars, no flow style

// Use a flat unknown-value map to sidestep TypeScript's recursive type alias restriction.
// At runtime we cast values to the appropriate shape when we need them.
type YamlMap = Record<string, unknown>;

function parseYaml(text: string): YamlMap {
    const lines = text.split('\n');
    const root: YamlMap = {};
    parseYamlLines(lines, 0, root);
    return root;
}

function getIndent(line: string): number {
    let i = 0;
    while (i < line.length && line[i] === ' ') i++;
    return i;
}

function parseYamlLines(lines: string[], startIndent: number, out: YamlMap): number {
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trimEnd();

        // Skip blank or comment lines
        if (!trimmed || trimmed.trimStart().startsWith('#')) { i++; continue; }

        const indent = getIndent(trimmed);

        // Dedent signals end of this block
        if (indent < startIndent) break;
        if (indent > startIndent) { i++; continue; }

        // Sequence item at this level (parent already knows it's a sequence)
        if (trimmed.trimStart().startsWith('- ')) {
            // Return: let the caller handle sequences
            break;
        }

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) { i++; continue; }

        const key = trimmed.slice(0, colonIdx).trim();
        const rest = trimmed.slice(colonIdx + 1).trim();

        if (rest) {
            // Inline scalar value — strip optional quotes
            out[key] = unquote(rest);
            i++;
        } else {
            // Peek ahead to determine if next non-blank is a mapping or sequence
            let peekIdx = i + 1;
            while (peekIdx < lines.length && !lines[peekIdx].trim()) peekIdx++;

            if (peekIdx >= lines.length) { out[key] = ''; i++; continue; }

            const peekLine = lines[peekIdx];
            const peekIndent = getIndent(peekLine);
            const peekTrimmed = peekLine.trimStart();

            if (peekTrimmed.startsWith('- ')) {
                // Sequence
                const seq: string[] = [];
                i++;
                while (i < lines.length) {
                    const sl = lines[i];
                    const st = sl.trim();
                    if (!st) { i++; continue; }
                    if (getIndent(sl) < peekIndent) break;
                    if (st.startsWith('- ')) {
                        seq.push(unquote(st.slice(2).trim()));
                        i++;
                    } else {
                        break;
                    }
                }
                out[key] = seq;
            } else if (peekIndent > indent) {
                // Nested mapping — consume lines for child block
                const childLines = lines.slice(i + 1);
                const childMap: YamlMap = {};
                const consumed = parseYamlLines(childLines, peekIndent, childMap);
                out[key] = childMap;
                i += 1 + consumed;
            } else {
                out[key] = '';
                i++;
            }
        }
    }
    return i;
}

function unquote(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

// ── YAML → SkillFrontmatter ───────────────────────────────────────────────────

function buildParameters(raw: YamlMap): FunctionDeclaration['parameters'] | undefined {
    if (!raw) return undefined;
    const type = String(raw['type'] ?? 'object');
    const propsRaw = raw['properties'] as YamlMap | undefined;
    const properties: FunctionDeclaration['parameters']['properties'] = {};

    if (propsRaw && typeof propsRaw === 'object' && !Array.isArray(propsRaw)) {
        for (const [propName, propVal] of Object.entries(propsRaw)) {
            if (typeof propVal === 'object' && !Array.isArray(propVal)) {
                const pv = propVal as YamlMap;
                properties[propName] = {
                    type: String(pv['type'] ?? 'string'),
                    description: String(pv['description'] ?? ''),
                    ...(pv['enum'] && Array.isArray(pv['enum']) ? { enum: pv['enum'] as string[] } : {}),
                    ...(pv['items'] && typeof pv['items'] === 'object' && !Array.isArray(pv['items'])
                        ? { items: { type: String((pv['items'] as YamlMap)['type'] ?? 'string') } }
                        : {}),
                };
            }
        }
    }

    const requiredRaw = raw['required'];
    const required = Array.isArray(requiredRaw) ? requiredRaw as string[] : undefined;

    return { type, properties, ...(required ? { required } : {}) };
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
