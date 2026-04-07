/**
 * adapters/telegram-adapter.ts — Telegram implementation of PlatformAdapter.
 *
 * Wraps Telegraf and normalizes all platform-specific APIs into the
 * PlatformAdapter interface so the core engine never touches Telegraf directly.
 */

import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { promises as fs } from 'fs';
import { markdownToTelegram } from '../../utils/markdown-converter.js';
import type {
    PlatformAdapter,
    NormalizedMessage,
    NormalizedCallback,
    SendMessageOptions,
    SentMessage,
    MediaPayload,
} from '../../types/platform.js';

export class TelegramAdapter implements PlatformAdapter {
    readonly platform = 'telegram' as const;
    private bot: Telegraf;
    private messageHandler?: (msg: NormalizedMessage) => Promise<void>;
    private callbackHandler?: (cb: NormalizedCallback) => Promise<void>;

    constructor(token: string) {
        this.bot = new Telegraf(token);
    }

    /** Expose the underlying Telegraf instance for legacy code that still needs it during migration */
    get telegraf(): Telegraf {
        return this.bot;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    async start(): Promise<void> {
        this._setupListeners();
        this.bot.launch();
    }

    async stop(): Promise<void> {
        this.bot.stop('SIGTERM');
    }

    // ── Outbound ─────────────────────────────────────────────────────────

    async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<SentMessage> {
        const extra: Record<string, unknown> = {};

        if (opts?.parseMode === 'html') {
            extra.parse_mode = 'HTML';
        } else if (opts?.parseMode === 'markdown') {
            extra.parse_mode = 'Markdown';
        }

        if (opts?.replyToId) {
            extra.reply_parameters = { message_id: parseInt(opts.replyToId, 10) };
        }

        if (opts?.inlineKeyboard) {
            extra.reply_markup = {
                inline_keyboard: opts.inlineKeyboard.map(row =>
                    row.map(btn => ({ text: btn.text, callback_data: btn.callbackData }))
                ),
            };
        }

        const result = await this.bot.telegram.sendMessage(parseInt(chatId, 10), text, extra);
        return { id: String(result.message_id), chatId };
    }

    async editMessage(chatId: string, messageId: string, text: string, opts?: SendMessageOptions): Promise<void> {
        const extra: Record<string, unknown> = {};
        if (opts?.parseMode === 'html') {
            extra.parse_mode = 'HTML';
        } else if (opts?.parseMode === 'markdown') {
            extra.parse_mode = 'Markdown';
        }
        if (opts?.inlineKeyboard) {
            extra.reply_markup = {
                inline_keyboard: opts.inlineKeyboard.map(row =>
                    row.map(btn => ({ text: btn.text, callback_data: btn.callbackData }))
                ),
            };
        }
        await this.bot.telegram.editMessageText(
            parseInt(chatId, 10),
            parseInt(messageId, 10),
            undefined,
            text,
            extra,
        );
    }

    async deleteMessage(chatId: string, messageId: string): Promise<void> {
        await this.bot.telegram.deleteMessage(parseInt(chatId, 10), parseInt(messageId, 10));
    }

    // ── Media ────────────────────────────────────────────────────────────

    async downloadFile(fileId: string, destPath: string): Promise<void> {
        const fileLink = await this.bot.telegram.getFileLink(fileId);
        const res = await fetch(fileLink.href);
        if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
        await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
    }

    // ── Format ───────────────────────────────────────────────────────────

    formatMarkdown(md: string): string {
        return markdownToTelegram(md);
    }

    // ── Event registration ───────────────────────────────────────────────

    onMessage(handler: (msg: NormalizedMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    onCallbackQuery(handler: (cb: NormalizedCallback) => Promise<void>): void {
        this.callbackHandler = handler;
    }

    // ── Telegram command menu ────────────────────────────────────────────

    async setCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
        await this.bot.telegram.setMyCommands(commands);
    }

    // ── Internal listeners ───────────────────────────────────────────────

    private _setupListeners(): void {
        // Text messages
        this.bot.on(message('text'), async (ctx) => {
            if (!this.messageHandler) return;
            const msg = this._normalizeTextMessage(ctx);
            await this.messageHandler(msg);
        });

        // Photo messages
        this.bot.on(message('photo'), async (ctx) => {
            if (!this.messageHandler) return;
            const photos = ctx.message.photo;
            const largest = photos[photos.length - 1];
            const msg = this._normalizeMediaMessage(ctx, {
                type: 'photo',
                fileId: largest.file_id,
                mimeType: 'image/jpeg',
                caption: ctx.message.caption || undefined,
            });
            await this.messageHandler(msg);
        });

        // Voice / audio messages
        this.bot.on(message('voice'), async (ctx) => {
            if (!this.messageHandler) return;
            const msg = this._normalizeMediaMessage(ctx, {
                type: 'voice',
                fileId: ctx.message.voice.file_id,
                mimeType: 'audio/ogg',
            });
            await this.messageHandler(msg);
        });

        this.bot.on(message('audio'), async (ctx) => {
            if (!this.messageHandler) return;
            const msg = this._normalizeMediaMessage(ctx, {
                type: 'voice',
                fileId: ctx.message.audio.file_id,
                mimeType: ctx.message.audio.mime_type || 'audio/mpeg',
            });
            await this.messageHandler(msg);
        });

        // Document messages
        this.bot.on(message('document'), async (ctx) => {
            if (!this.messageHandler) return;
            const doc = ctx.message.document;
            const msg = this._normalizeMediaMessage(ctx, {
                type: 'document',
                fileId: doc.file_id,
                fileName: doc.file_name || 'document',
                mimeType: doc.mime_type || 'application/octet-stream',
                fileSize: doc.file_size,
                caption: ctx.message.caption || undefined,
            });
            await this.messageHandler(msg);
        });

        // Callback queries
        this.bot.on('callback_query', async (ctx) => {
            if (!this.callbackHandler) return;
            const data = (ctx.callbackQuery as any)?.data;
            if (!data) return;
            const chatId = String(ctx.callbackQuery.message?.chat?.id ?? '');
            const messageId = String(ctx.callbackQuery.message?.message_id ?? '');
            const tenantKey = `telegram:${chatId}` as any;

            await this.callbackHandler({
                tenantKey,
                platform: 'telegram',
                chatId,
                messageId,
                data,
                _raw: ctx,
            });
        });

        this.bot.catch((err: any) => {
            console.error(`[TelegramAdapter Error] ${err}`);
        });
    }

    private _normalizeTextMessage(ctx: any): NormalizedMessage {
        const chatId = String(ctx.chat.id);
        const replyTo = ctx.message.reply_to_message;
        const quotedText: string | undefined = replyTo?.text ?? replyTo?.caption ?? undefined;

        return {
            id: String(ctx.message.message_id),
            tenantKey: `telegram:${chatId}` as any,
            platform: 'telegram',
            chatId,
            userName: ctx.chat.first_name || 'User',
            text: ctx.message.text,
            quotedText,
            _raw: ctx,
        };
    }

    private _normalizeMediaMessage(ctx: any, media: MediaPayload): NormalizedMessage {
        const chatId = String(ctx.chat.id);
        return {
            id: String(ctx.message.message_id),
            tenantKey: `telegram:${chatId}` as any,
            platform: 'telegram',
            chatId,
            userName: ctx.chat.first_name || 'User',
            text: ctx.message.caption || '',
            media,
            _raw: ctx,
        };
    }
}
