/**
 * types/platform.ts — Platform-agnostic types for multi-channel support.
 *
 * All message handlers, tools, and commands operate on these normalized types
 * instead of platform-specific objects (Telegraf ctx, Feishu event, etc.).
 */

// ── Platform Enum ────────────────────────────────────────────────────────────

export type Platform = 'telegram' | 'feishu' | 'web';

// ── Tenant Key ───────────────────────────────────────────────────────────────

/**
 * Identifies a specific client connection: `{platform}:{platformUserId}`.
 * Example: "telegram:123456789", "feishu:ou_xxxx", "web:session_abc".
 *
 * Multiple TenantKeys can map to the same UserId (same person, different clients).
 */
export type TenantKey = `${Platform}:${string}`;

/**
 * Platform-agnostic user identifier. Defined in users.json.
 * Example: "zhengchao".
 * A UserId owns exactly one workspace; multiple TenantKeys can map to it.
 */
export type UserId = string;

export function makeTenantKey(platform: Platform, userId: string | number): TenantKey {
    return `${platform}:${userId}` as TenantKey;
}

export function parseTenantKey(key: TenantKey): { platform: Platform; userId: string } {
    const idx = key.indexOf(':');
    return {
        platform: key.slice(0, idx) as Platform,
        userId: key.slice(idx + 1),
    };
}

// ── Normalized Message ───────────────────────────────────────────────────────

export interface NormalizedMessage {
    /** Unique message ID on the platform */
    id: string;
    /** Tenant key of the sender */
    tenantKey: TenantKey;
    /** Platform this message originated from */
    platform: Platform;
    /** Platform-specific chat/channel ID (numeric for Telegram, string for Feishu) */
    chatId: string;
    /** Display name of the sender */
    userName: string;
    /** Text content */
    text: string;
    /** Quoted/replied-to text, if any */
    quotedText?: string;
    /** Media attachment, if any */
    media?: MediaPayload;
    /** Raw platform context — only used by the adapter layer, never by business logic */
    _raw?: unknown;
}

export interface MediaPayload {
    type: 'voice' | 'photo' | 'document';
    /** Platform-specific file ID for download */
    fileId: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    /** For photos: the caption text */
    caption?: string;
}

// ── Send Options ─────────────────────────────────────────────────────────────

export interface SendMessageOptions {
    replyToId?: string;
    parseMode?: 'markdown' | 'html' | 'text';
    inlineKeyboard?: InlineButton[][];
}

export interface InlineButton {
    text: string;
    callbackData: string;
}

// ── Sent Message Reference ───────────────────────────────────────────────────

export interface SentMessage {
    id: string;
    chatId: string;
}

// ── Callback Query ───────────────────────────────────────────────────────────

export interface NormalizedCallback {
    tenantKey: TenantKey;
    platform: Platform;
    chatId: string;
    messageId: string;
    data: string;
    /** Raw platform context for adapter-specific responses (e.g. answerCbQuery) */
    _raw?: unknown;
}

// ── Platform Adapter Interface ───────────────────────────────────────────────

export interface PlatformAdapter {
    readonly platform: Platform;

    /** Start listening for events */
    start(): Promise<void>;

    /** Graceful shutdown */
    stop(): Promise<void>;

    // ── Outbound messaging ───────────────────────────────────────────────

    sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<SentMessage>;
    editMessage(chatId: string, messageId: string, text: string, opts?: SendMessageOptions): Promise<void>;
    deleteMessage(chatId: string, messageId: string): Promise<void>;

    // ── Media ────────────────────────────────────────────────────────────

    /** Send a photo (from local file path or Buffer) with optional caption */
    sendPhoto(chatId: string, photo: string | Buffer, caption?: string): Promise<SentMessage>;

    /** Download a file by its platform file ID, returns local path */
    downloadFile(fileId: string, destPath: string): Promise<void>;

    // ── Format ───────────────────────────────────────────────────────────

    /** Convert standard markdown to the platform's native format */
    formatMarkdown(md: string): string;

    // ── Event registration (called by the core engine) ───────────────────

    onMessage(handler: (msg: NormalizedMessage) => Promise<void>): void;
    onCallbackQuery(handler: (cb: NormalizedCallback) => Promise<void>): void;
}
