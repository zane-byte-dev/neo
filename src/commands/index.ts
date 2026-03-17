/**
 * src/commands/index.ts — Auto-discovery registry for all commands.
 *
 * To add a new command module, create src/commands/my-command.ts and export
 * a `Command` object. It will be picked up automatically.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoLoad } from '../lib/auto-loader.js';
import type { Command, CommandDeps } from './_base.js';

export type { Command, CommandDeps } from './_base.js';

function isCommand(value: unknown): value is Command {
    return (
        typeof value === 'object' &&
        value !== null &&
        'commands' in value &&
        'handler' in value &&
        Array.isArray((value as Command).commands) &&
        typeof (value as Command).handler === 'function'
    );
}

let commandRegistry: Command[] = [];

export async function setupCommands(): Promise<void> {
    const dir = dirname(fileURLToPath(import.meta.url));
    commandRegistry = await autoLoad(dir, isCommand);
    console.log(`[Commands] ✅ ${commandRegistry.length} command modules registered`);
}

export async function handleCommand(deps: CommandDeps, ctx: any): Promise<void> {
    const text = ctx.message.text as string;
    const [command] = text.split(' ');

    console.log(`[Command] Received: ${command}`);

    for (const mod of commandRegistry) {
        if (await mod.handler(command, text, ctx, deps)) {
            return;
        }
    }

    await ctx.reply('Unknown command. Try /start for help.');
}
