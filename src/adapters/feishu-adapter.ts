/**
 * adapters/feishu-adapter.ts — Feishu (Lark) implementation of PlatformAdapter.
 *
 * Requires @larksuiteoapi/node-sdk to be installed.
 * Set environment variables: FEISHU_APP_ID, FEISHU_APP_SECRET.
 *
 * This is a skeleton — fill in event subscription & messaging once
 * the Feishu Open Platform App is configured.
 */

import type {
    PlatformAdapter,
    NormalizedMessage,
    NormalizedCallback,
    SendMessageOptions,
    SentMessage,
} from '../types/platform.js';

export class FeishuAdapter implements PlatformAdapter {
    readonly platform = 'feishu' as const;

    private messageHandler?: (msg: NormalizedMessage) => Promise<void>;
    private callbackHandler?: (cb: NormalizedCallback) => Promise<void>;

    private appId: string;
    private appSecret: string;
    private client: any; // lark.Client once SDK is installed

    constructor(opts: { appId: string; appSecret: string }) {
        this.appId = opts.appId;
        this.appSecret = opts.appSecret;
        // Will be initialised in start() once SDK is available
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    async start(): Promise<void> {
        try {
            // Dynamic import — the SDK is optional; only needed when Feishu tenants are configured
            const lark = await (Function('return import("@larksuiteoapi/node-sdk")')() as Promise<any>);
            this.client = new lark.Client({
                appId: this.appId,
                appSecret: this.appSecret,
                appType: lark.AppType?.SelfBuild,
            });
            // TODO: register event subscriptions (im.message.receive_v1, etc.)
            console.log('[FeishuAdapter] Client initialized. Event subscription not yet wired.');
        } catch (err: any) {
            console.error('[FeishuAdapter] Failed to start — is @larksuiteoapi/node-sdk installed?', err.message);
            throw err;
        }
    }

    async stop(): Promise<void> {
        // Feishu SDK doesn't have a persistent connection to close
        this.client = null;
    }

    // ── Outbound ─────────────────────────────────────────────────────────

    async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<SentMessage> {
        if (!this.client) throw new Error('[FeishuAdapter] Not started');

        const content = JSON.stringify({ text });
        const res = await this.client.im.message.create({
            data: {
                receive_id: chatId,
                msg_type: 'text',
                content,
            },
            params: { receive_id_type: 'open_id' },
        });

        const messageId = res?.data?.message_id ?? '';
        return { id: messageId, chatId };
    }

    async editMessage(chatId: string, messageId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
        if (!this.client) throw new Error('[FeishuAdapter] Not started');

        const content = JSON.stringify({ text });
        await this.client.im.message.patch({
            path: { message_id: messageId },
            data: { content },
        });
    }

    async deleteMessage(_chatId: string, messageId: string): Promise<void> {
        if (!this.client) throw new Error('[FeishuAdapter] Not started');

        await this.client.im.message.delete({
            path: { message_id: messageId },
        });
    }

    // ── Media ────────────────────────────────────────────────────────────

    async downloadFile(fileId: string, destPath: string): Promise<void> {
        if (!this.client) throw new Error('[FeishuAdapter] Not started');

        const { writeFile } = await import('fs/promises');
        const res = await this.client.im.messageResource.get({
            path: { message_id: fileId, file_key: fileId },
            params: { type: 'file' },
        });

        if (res?.data) {
            await writeFile(destPath, Buffer.from(res.data));
        } else {
            throw new Error(`[FeishuAdapter] File download failed for ${fileId}`);
        }
    }

    // ── Format ───────────────────────────────────────────────────────────

    formatMarkdown(md: string): string {
        // Feishu supports a subset of markdown; pass through for now
        return md;
    }

    // ── Event registration ───────────────────────────────────────────────

    onMessage(handler: (msg: NormalizedMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    onCallbackQuery(handler: (cb: NormalizedCallback) => Promise<void>): void {
        this.callbackHandler = handler;
    }

    // ── Telegram-compat stubs ────────────────────────────────────────────

    async setCommands(_commands: Array<{ command: string; description: string }>): Promise<void> {
        // Feishu doesn't have a /command menu equivalent
    }

    // ── Internal: normalize incoming Feishu events ───────────────────────

    /** Call this from your Feishu webhook/event handler */
    async handleIncomingMessage(event: any): Promise<void> {
        if (!this.messageHandler) return;

        const sender = event?.sender?.sender_id?.open_id ?? '';
        const chatId = sender;
        const msgId = event?.message?.message_id ?? '';
        const content = event?.message?.content ? JSON.parse(event.message.content) : {};
        const text = content.text ?? '';

        const normalized: NormalizedMessage = {
            id: msgId,
            tenantKey: `feishu:${chatId}` as any,
            platform: 'feishu',
            chatId,
            userName: event?.sender?.sender_id?.union_id ?? 'User',
            text,
            _raw: event,
        };

        await this.messageHandler(normalized);
    }
}
