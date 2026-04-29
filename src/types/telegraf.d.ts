declare module 'telegraf/types' {
    interface Update {
        update_id: number;
        message?: Record<string, unknown>;
        [key: string]: unknown;
    }

    export { Update };
}

declare module 'telegraf/filters' {
    import type { Update } from 'telegraf/types';

    /** Create a filter function for message sub-types (photo, document, voice, text, etc.) */
    export function message(key: string): (update: Update) => boolean;
}

/**
 * Minimal Telegraf type declarations.
 *
 * Telegraf 4.16's typings/index.d.ts re-exports from src/*.ts which breaks
 * strict ESM compilation.  This override provides just enough surface for
 * our usage.
 */
declare module 'telegraf' {
    import type { Update } from 'telegraf/types';

    type MaybePromise<T> = T | Promise<T>;

    interface TelegrafOptions {
        telegram?: Record<string, unknown>;
        handlerTimeout?: number;
    }

    interface InputFile {
        source: Buffer;
    }

    interface PhotoSize {
        file_id: string;
        file_unique_id: string;
        width: number;
        height: number;
        file_size?: number;
    }

    interface Document {
        file_id: string;
        file_unique_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
    }

    interface Voice {
        file_id: string;
        file_unique_id: string;
        duration: number;
        mime_type?: string;
        file_size?: number;
    }

    interface TextMessage {
        text: string;
        message_id: number;
        chat: { id: number };
    }

    interface PhotoMessage {
        photo: PhotoSize[];
        caption?: string;
        message_id: number;
        chat: { id: number };
    }

    interface DocumentMessage {
        document: Document;
        caption?: string;
        message_id: number;
        chat: { id: number };
    }

    interface VoiceMessage {
        voice: Voice;
        message_id: number;
        chat: { id: number };
    }

    interface Telegram {
        sendMessage(chatId: string | number, text: string, extra?: Record<string, unknown>): Promise<unknown>;
        getFileLink(fileId: string): Promise<URL>;
    }

    interface Context {
        chat: { id: number; type: string };
        message: { text: string; message_id: number; chat: { id: number } };
        telegram: Telegram;
        reply(text: string, extra?: Record<string, unknown>): Promise<void>;
        replyWithPhoto(photo: InputFile, extra?: { caption?: string }): Promise<unknown>;
        sendChatAction(action: string): Promise<void>;
    }

    /** Type guard / filter function returned by telegraf/filters */
    type FilterFn = (update: Update) => boolean;

    interface TextContext extends Context {
        message: TextMessage;
    }

    interface PhotoContext extends Context {
        message: PhotoMessage;
    }

    interface DocumentContext extends Context {
        message: DocumentMessage;
    }

    interface VoiceContext extends Context {
        message: VoiceMessage;
    }

    class Telegraf {
        telegram: Telegram;
        constructor(token: string, options?: TelegrafOptions);
        start(handler: (ctx: Context) => MaybePromise<void>): void;
        command(name: string, handler: (ctx: Context) => MaybePromise<void>): void;
        on(event: 'text', handler: (ctx: TextContext) => MaybePromise<void>): void;
        on(event: FilterFn, handler: (ctx: Context) => MaybePromise<void>): void;
        launch(): Promise<void>;
        stop(reason?: string): void;
    }

    export { Telegraf, Telegram, Context, TextContext, PhotoContext, DocumentContext, VoiceContext, FilterFn };
}
