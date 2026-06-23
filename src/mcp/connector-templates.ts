/**
 * src/mcp/connector-templates.ts — Built-in connector templates.
 *
 * A template turns a small form (a few labelled fields) into a concrete stdio
 * MCP server config, so users can add common connectors without hand-writing
 * `mcp.json`. Sensitive fields are flagged so the UI / storage layer can keep
 * them out of version-controlled config (handled in a later slice).
 *
 * Templates intentionally describe *stdio* servers only — remote HTTP / OAuth
 * transports are out of scope for the first slice (see the connector-center
 * dev plan).
 */

export interface ConnectorTemplateField {
    /** Input key the user fills in. */
    key: string;
    label: string;
    placeholder?: string;
    required: boolean;
    /** Sensitive value (token / key) — must not be written to plaintext config. */
    secret: boolean;
}

/** Concrete stdio MCP server config produced by a template. */
export interface ExpandedServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

export interface ConnectorTemplate {
    id: string;
    label: string;
    description: string;
    fields: ConnectorTemplateField[];
    /** Build a concrete server config from collected inputs. */
    build: (inputs: Record<string, string>) => ExpandedServerConfig;
}

/** Serializable view of a template (without the `build` closure). */
export interface ConnectorTemplateSummary {
    id: string;
    label: string;
    description: string;
    fields: ConnectorTemplateField[];
}

const TEMPLATES: ConnectorTemplate[] = [
    {
        id: 'filesystem',
        label: 'Filesystem',
        description: '让 Agent 读写一个指定目录（基于官方 filesystem MCP server）。',
        fields: [
            {
                key: 'directory',
                label: '允许访问的目录',
                placeholder: '/Users/me/projects',
                required: true,
                secret: false,
            },
        ],
        build: (inputs) => ({
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', inputs.directory ?? ''],
        }),
    },
    {
        id: 'github',
        label: 'GitHub',
        description: '连接 GitHub MCP server，使用 Personal Access Token 鉴权。',
        fields: [
            {
                key: 'token',
                label: 'GitHub Personal Access Token',
                placeholder: 'ghp_…',
                required: true,
                secret: true,
            },
        ],
        build: (inputs) => ({
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: inputs.token ?? '' },
        }),
    },
    {
        id: 'custom-stdio',
        label: '自定义 stdio',
        description: '手动指定命令、参数与工作目录，适配任意 stdio MCP server。',
        fields: [
            { key: 'command', label: '命令', placeholder: 'npx', required: true, secret: false },
            {
                key: 'args',
                label: '参数（空格分隔）',
                placeholder: '-y @scope/server',
                required: false,
                secret: false,
            },
            { key: 'cwd', label: '工作目录', placeholder: '可选', required: false, secret: false },
        ],
        build: (inputs) => {
            const args = (inputs.args ?? '').trim();
            const cwd = (inputs.cwd ?? '').trim();
            return {
                command: (inputs.command ?? '').trim(),
                ...(args ? { args: args.split(/\s+/) } : {}),
                ...(cwd ? { cwd } : {}),
            };
        },
    },
];

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/** Return all templates without their (non-serializable) `build` closures. */
export function listConnectorTemplates(): ConnectorTemplateSummary[] {
    return TEMPLATES.map(({ id, label, description, fields }) => ({
        id,
        label,
        description,
        fields,
    }));
}

export function getConnectorTemplate(id: string): ConnectorTemplate | undefined {
    return TEMPLATE_BY_ID.get(id);
}

export interface ExpandTemplateResult {
    config?: ExpandedServerConfig;
    /** Required field keys the user left empty. */
    missing: string[];
    /** True when the template id is unknown. */
    unknownTemplate: boolean;
    /** Keys of the secret fields that were provided (for storage routing). */
    secretKeys: string[];
}

/**
 * Validate inputs against a template and build the server config.
 * Returns `missing` for any empty required field; never throws.
 */
export function expandTemplate(id: string, inputs: Record<string, string>): ExpandTemplateResult {
    const template = TEMPLATE_BY_ID.get(id);
    if (!template) return { missing: [], unknownTemplate: true, secretKeys: [] };

    const missing = template.fields
        .filter((f) => f.required && !(inputs[f.key] ?? '').trim())
        .map((f) => f.key);

    const secretKeys = template.fields
        .filter((f) => f.secret && (inputs[f.key] ?? '').trim())
        .map((f) => f.key);

    if (missing.length > 0) {
        return { missing, unknownTemplate: false, secretKeys };
    }
    return { config: template.build(inputs), missing: [], unknownTemplate: false, secretKeys };
}
