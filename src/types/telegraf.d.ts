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

    interface Context {
        chat: { id: number; type: string };
        message: { text: string; message_id: number; chat: { id: number } };
        reply(text: string, extra?: Record<string, unknown>): Promise<void>;
        replyWithPhoto(photo: InputFile, extra?: { caption?: string }): Promise<unknown>;
        sendChatAction(action: string): Promise<void>;
    }

    class Telegraf {
        constructor(token: string, options?: TelegrafOptions);
        start(handler: (ctx: Context) => MaybePromise<void>): void;
        command(name: string, handler: (ctx: Context) => MaybePromise<void>): void;
        on(event: 'text', handler: (ctx: Context) => MaybePromise<void>): void;
        launch(): Promise<void>;
        stop(reason?: string): void;
    }

    export { Telegraf, Context };
}
