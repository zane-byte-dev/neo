import type { Command } from './_base.js';

export const profileCommand: Command = {
    commands: ['/profile'],
    handler: async (command, text, msg, deps) => {
    if (command !== '/profile') return false;
    const reply = (t: string, md = false) => deps.adapter.sendMessage(msg.chatId, t, md ? { parseMode: 'markdown' } : undefined);

    const content = await deps.userProfile.toDisplayString();
    await reply(`👤 **个人档案**\n\n${content}\n\n_编辑方式: 直接修改 workspace 下的 \`USER.md\` 文件_`, true);
    return true;
    },
};
