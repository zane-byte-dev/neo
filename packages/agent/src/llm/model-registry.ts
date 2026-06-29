/**
 * model-registry.ts — single source of truth for Neo model aliases.
 */

export interface NeoModelDefinition {
    /** User/API-facing alias. */
    alias: string;
    /** Provider model id sent to the upstream API. */
    modelId: string;
    label: string;
    provider: 'DeepSeek';
    /** Whether this alias should appear in user-facing model pickers. */
    selectable: boolean;
    /** Whether this alias should appear in OpenAI-compatible model discovery. */
    gateway: boolean;
}

export const NEO_MODELS = [
    {
        alias: 'deepseek',
        modelId: 'deepseek-chat',
        label: 'DeepSeek Chat',
        provider: 'DeepSeek',
        selectable: true,
        gateway: true,
    },
    {
        alias: 'deepseek-chat',
        modelId: 'deepseek-chat',
        label: 'DeepSeek Chat',
        provider: 'DeepSeek',
        selectable: false,
        gateway: true,
    },
    {
        alias: 'deepseek-reasoner',
        modelId: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner',
        provider: 'DeepSeek',
        selectable: true,
        gateway: true,
    },
] as const satisfies readonly NeoModelDefinition[];

export const MODEL_ALIASES: Record<string, string> = Object.freeze(
    Object.fromEntries(NEO_MODELS.map((model) => [model.alias, model.modelId])),
);

export const AVAILABLE_MODEL_ALIASES = Object.freeze(
    NEO_MODELS.filter((model) => model.selectable).map((model) => model.alias),
);

export interface GatewayModelDescriptor {
    id: string;
    modelId: string;
    alias?: string;
}

export function resolveModelAlias(alias: string): string {
    return MODEL_ALIASES[alias] ?? alias;
}

export function isKnownModelAlias(alias: string): boolean {
    return Object.prototype.hasOwnProperty.call(MODEL_ALIASES, alias);
}

export function isSelectableModelAlias(alias: string): boolean {
    return (AVAILABLE_MODEL_ALIASES as readonly string[]).includes(alias);
}

export function isSupportedModelName(model: string): boolean {
    if (isKnownModelAlias(model)) return true;
    if (NEO_MODELS.some((entry) => entry.modelId === model)) return true;
    return model.startsWith('deepseek');
}

export function listGatewayModels(): GatewayModelDescriptor[] {
    const entries = new Map<string, GatewayModelDescriptor>();
    for (const model of NEO_MODELS) {
        if (!model.gateway) continue;
        entries.set(model.alias, {
            id: model.alias,
            modelId: model.modelId,
            ...(model.alias !== model.modelId ? { alias: model.alias } : {}),
        });
        if (!entries.has(model.modelId)) {
            entries.set(model.modelId, {
                id: model.modelId,
                modelId: model.modelId,
                ...(model.alias !== model.modelId ? { alias: model.alias } : {}),
            });
        }
    }
    return [...entries.values()];
}
