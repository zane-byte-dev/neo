/**
 * utils/yaml.ts — Shared mini YAML parser.
 *
 * Supports the subset of YAML needed for skill frontmatter and tool declarations:
 *  - top-level key: scalar
 *  - nested mappings (2-space indent)
 *  - inline sequences with "- value"
 *  - no anchors, no multiline scalars, no flow style
 */

export type YamlMap = Record<string, unknown>;

export function parseYaml(text: string): YamlMap {
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

        if (!trimmed || trimmed.trimStart().startsWith('#')) { i++; continue; }

        const indent = getIndent(trimmed);

        if (indent < startIndent) break;
        if (indent > startIndent) { i++; continue; }

        if (trimmed.trimStart().startsWith('- ')) break;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) { i++; continue; }

        const key = trimmed.slice(0, colonIdx).trim();
        const rest = trimmed.slice(colonIdx + 1).trim();

        if (rest) {
            out[key] = unquote(rest);
            i++;
        } else {
            let peekIdx = i + 1;
            while (peekIdx < lines.length && !lines[peekIdx].trim()) peekIdx++;

            if (peekIdx >= lines.length) { out[key] = ''; i++; continue; }

            const peekLine = lines[peekIdx];
            const peekIndent = getIndent(peekLine);
            const peekTrimmed = peekLine.trimStart();

            if (peekTrimmed.startsWith('- ')) {
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

/**
 * Build a FunctionDeclaration-compatible `parameters` object from a YAML map.
 */
export function buildParameters(raw: YamlMap): {
    type: string;
    properties: Record<string, { type: string; description: string; items?: { type: string }; enum?: string[] }>;
    required?: string[];
} | undefined {
    if (!raw) return undefined;
    const type = String(raw['type'] ?? 'object');
    const propsRaw = raw['properties'] as YamlMap | undefined;
    const properties: Record<string, { type: string; description: string; items?: { type: string }; enum?: string[] }> = {};

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
