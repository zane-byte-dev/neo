/**
 * adapters/feishu-adapter.ts — Feishu (Lark) implementation of PlatformAdapter.
 *
 * Uses @larksuiteoapi/node-sdk's WebSocket long connection (WSClient + EventDispatcher),
 * so **no public IP or webhook callback URL is needed** — the SDK maintains a persistent
 * WebSocket to Feishu's servers and pushes events directly.
 *
 * Set environment variables: FEISHU_APP_ID, FEISHU_APP_SECRET.
 *
 * In the Feishu Developer Console, go to:
 *   Events and Callbacks → Mode of event/callback subscription
 *     → "Receive events/callbacks through persistent connection"
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type {
    PlatformAdapter,
    NormalizedMessage,
    NormalizedCallback,
    SendMessageOptions,
    SentMessage,
} from '../../types/platform.js';

export class FeishuAdapter implements PlatformAdapter {
    readonly platform = 'feishu' as const;

    private messageHandler?: (msg: NormalizedMessage) => Promise<void>;
    private callbackHandler?: (cb: NormalizedCallback) => Promise<void>;

    private appId: string;
    private appSecret: string;
    private client: InstanceType<typeof lark.Client>;
    private wsClient?: InstanceType<typeof lark.WSClient>;
    private eventDispatcher?: InstanceType<typeof lark.EventDispatcher>;

    constructor(opts: { appId: string; appSecret: string }) {
        this.appId = opts.appId;
        this.appSecret = opts.appSecret;
        this.client = new lark.Client({
            appId: this.appId,
            appSecret: this.appSecret,
            appType: lark.AppType.SelfBuild,
        });
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    async start(): Promise<void> {
        // Build event dispatcher with message handler
        this.eventDispatcher = new lark.EventDispatcher({}).register({
            'im.message.receive_v1': async (data: any) => {
                try {
                    await this._handleMessageEvent(data);
                } catch (err: any) {
                    console.error('[FeishuAdapter] Message handler error:', err.message);
                }
            },
        });

        // Create WebSocket client — maintains persistent connection, auto-reconnects
        this.wsClient = new lark.WSClient({
            appId: this.appId,
            appSecret: this.appSecret,
            loggerLevel: lark.LoggerLevel.info,
        });

        await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
        console.log('[FeishuAdapter] ✅ WebSocket long connection started.');
    }

    async stop(): Promise<void> {
        // SDK doesn't expose a close/disconnect method — just drop references
        this.wsClient = undefined;
        this.eventDispatcher = undefined;
        console.log('[FeishuAdapter] Stopped.');
    }

    // ── Outbound ─────────────────────────────────────────────────────────

    async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<SentMessage> {
        const content = this._buildContent(text, opts);
        const msgType = (opts?.parseMode === 'markdown') ? 'interactive' : 'text';

        const res = await this.client.im.message.create({
            data: {
                receive_id: chatId,
                msg_type: msgType,
                content: JSON.stringify(content),
            },
            params: { receive_id_type: 'open_id' },
        });

        const messageId = res?.data?.message_id ?? '';
        return { id: messageId, chatId };
    }

    async editMessage(_chatId: string, messageId: string, text: string, opts?: SendMessageOptions): Promise<void> {
        const content = this._buildContent(text, opts);

        await this.client.im.message.patch({
            path: { message_id: messageId },
            data: { content: JSON.stringify(content) },
        });
    }

    async deleteMessage(_chatId: string, messageId: string): Promise<void> {
        await this.client.im.message.delete({
            path: { message_id: messageId },
        });
    }

    // ── Media ────────────────────────────────────────────────────────────

    async downloadFile(fileId: string, destPath: string): Promise<void> {
        // fileId format: "messageId:fileKey"
        const [messageId, fileKey] = fileId.includes(':') ? fileId.split(':') : [fileId, fileId];

        const res = await this.client.im.messageResource.get({
            path: { message_id: messageId, file_key: fileKey },
            params: { type: 'file' },
        });

        await res.writeFile(destPath);
    }

    // ── Format ───────────────────────────────────────────────────────────

    formatMarkdown(md: string): string {
        // Feishu rich text card supports a subset of markdown; pass through
        return md;
    }

    // ── Event registration ───────────────────────────────────────────────

    onMessage(handler: (msg: NormalizedMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    onCallbackQuery(handler: (cb: NormalizedCallback) => Promise<void>): void {
        this.callbackHandler = handler;
    }

    // ── Internal: build message content ──────────────────────────────────

    private _buildContent(text: string, opts?: SendMessageOptions): Record<string, unknown> {
        if (opts?.parseMode === 'markdown') {
            // Use interactive card for markdown rendering
            return {
                type: 'template',
                data: {
                    template_variable: { content: text },
                    template_id: undefined, // falls back to default card
                },
                elements: [{ tag: 'markdown', content: text }],
            };
        }
        return { text };
    }

    // ── Internal: normalize incoming Feishu events ───────────────────────

    private async _handleMessageEvent(data: any): Promise<void> {
        if (!this.messageHandler) return;

        const message = data?.message;
        const sender = data?.sender;
        if (!message || !sender) return;

        const chatType = message.chat_type; // 'p2p' or 'group'
        const senderId = sender.sender_id?.open_id ?? '';
        const chatId = senderId; // for p2p, use sender's open_id
        const msgId = message.message_id ?? '';

        // Parse message content (JSON string)
        let text = '';
        let mediaPayload: NormalizedMessage['media'] = undefined;

        const msgType = message.message_type;
        try {
            const content = message.content ? JSON.parse(message.content) : {};

            switch (msgType) {
                case 'text':
                    text = content.text ?? '';
                    // Strip @bot mentions: "@_user_1" pattern
                    text = text.replace(/@_user_\d+\s*/g, '').trim();
                    break;
                case 'image':
                    mediaPayload = {
                        type: 'photo',
                        fileId: `${msgId}:${content.image_key}`,
                        mimeType: 'image/jpeg',
                    };
                    break;
                case 'audio':
                    mediaPayload = {
                        type: 'voice',
                        fileId: `${msgId}:${content.file_key}`,
                        mimeType: 'audio/ogg',
                    };
                    break;
                case 'file':
                    mediaPayload = {
                        type: 'document',
                        fileId: `${msgId}:${content.file_key}`,
                        fileName: content.file_name || 'document',
                        mimeType: content.mime_type || 'application/octet-stream',
                    };
                    break;
                default:
                    // post (rich text), merge_forward, etc. — extract text best-effort
                    text = content.text ?? content.title ?? JSON.stringify(content).slice(0, 500);
            }
        } catch {
            console.warn(`[FeishuAdapter] Failed to parse message content: ${message.content}`);
        }

        // Handle parent/reply context
        const parentId = message.parent_id;
        let quotedText: string | undefined;
        if (parentId) {
            try {
                const parentMsg = await this.client.im.message.get({
                    path: { message_id: parentId },
                });
                const parentContent = parentMsg?.data?.items?.[0]?.body?.content;
                if (parentContent) {
                    const parsed = JSON.parse(parentContent);
                    quotedText = parsed.text ?? parsed.title;
                }
            } catch { /* ignore quote fetch failures */ }
        }

        const normalized: NormalizedMessage = {
            id: msgId,
            tenantKey: `feishu:${chatId}` as any,
            platform: 'feishu',
            chatId,
            userName: sender.sender_id?.union_id ?? senderId,
            text,
            quotedText,
            media: mediaPayload,
            _raw: data,
        };

        await this.messageHandler(normalized);
    }
}
