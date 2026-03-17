import { message } from 'telegraf/filters';

interface HandlersDeps {
    bot: any;
    handleCommand: (ctx: any) => Promise<void>;
    processMessage: (ctx: any) => Promise<void>;
    processPhotoMessage: (ctx: any) => Promise<void>;
    processVoiceMessage: (ctx: any) => Promise<void>;
    processDocumentMessage: (ctx: any) => Promise<void>;
}

export function setupHandlers(deps: HandlersDeps) {
    deps.bot.command('start', (ctx: any) => {
        void deps.handleCommand(ctx);
    });

    deps.bot.on(message('text'), async (ctx: any) => {
        await deps.processMessage(ctx);
    });

    deps.bot.on(message('photo'), async (ctx: any) => {
        await deps.processPhotoMessage(ctx);
    });

    deps.bot.on(message('voice'), async (ctx: any) => {
        await deps.processVoiceMessage(ctx);
    });

    deps.bot.on(message('audio'), async (ctx: any) => {
        await deps.processVoiceMessage(ctx);
    });

    deps.bot.on(message('document'), async (ctx: any) => {
        await deps.processDocumentMessage(ctx);
    });

    deps.bot.catch((err: any) => {
        console.error(`[Bot Error] ${err}`);
    });
}
