import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export default function registerAtxProvider(pi: ExtensionAPI): void {
    const baseUrl = process.env.NEO_PI_ATX_URL ?? 'http://127.0.0.1:8080';
    const model = process.env.NEO_PI_ATX_MODEL ?? 'claude-opus-4-8';
    const gatewayKey = process.env.NEO_PI_ATX_GATEWAY_KEY ?? 'atx-local';
    const reasoning = process.env.NEO_PI_ATX_REASONING !== '0';

    pi.registerProvider('atx', {
        name: 'ATX local gateway',
        baseUrl,
        apiKey: gatewayKey,
        // ATX exposes one Anthropic-compatible entrypoint and translates it
        // when the routed upstream is OpenAI-compatible (DeepSeek included).
        api: 'anthropic-messages',
        models: [{
            id: model,
            name: `${model} (ATX)`,
            reasoning,
            input: ['text', 'image'],
            cost: zeroCost,
            contextWindow: 1_000_000,
            maxTokens: 128_000,
            compat: {
                forceAdaptiveThinking: reasoning,
                allowEmptySignature: true,
                supportsEagerToolInputStreaming: false,
            },
        }],
    });
}
