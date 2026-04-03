import type { Command } from './_base.js';

export const profileCommand: Command = {
    commands: ['/profile'],
    handler: async (command, text, msg, deps) => {
    if (command !== '/profile') return false;
    const reply = (t: string, md = false) => deps.adapter.sendMessage(msg.chatId, t, md ? { parseMode: 'markdown' } : undefined);

    const args = text.split(' ').slice(1);
    const sub = args[0];

    if (!sub || sub === 'show') {
        await reply(
            `👤 **个人信息**\n\n${deps.userProfile.toDisplayString()}`,
            true
        );
        return true;
    }

    if (sub === 'clear') {
        await deps.userProfile.clear();
        await reply('✅ 个人信息已清空。');
        return true;
    }

    if (sub === 'set') {
        const field = args[1];
        const value = args.slice(2).join(' ');
        if (!field || !value) {
            await reply(
                '用法:\n' +
                '`/profile set name 你的名字`\n' +
                '`/profile set city 所在城市`\n' +
                '`/profile set timezone Asia/Shanghai`\n' +
                '`/profile set language 中文`\n' +
                '`/profile set interests 科技,投资,健身`\n' +
                '`/profile set notes 自由描述，如职业、习惯等`',
                true
            );
            return true;
        }

        const allowed = ['name', 'city', 'timezone', 'language', 'interests', 'notes'];
        if (!allowed.includes(field)) {
            await reply(`❌ 不支持的字段 \`${field}\`，可用: ${allowed.join(', ')}`, true);
            return true;
        }

        const patch: any = field === 'interests'
            ? { interests: value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }
            : { [field]: value };
        await deps.userProfile.update(patch);
        await reply(`✅ 已更新 ${field}。\n\n${deps.userProfile.toDisplayString()}`, true);
        return true;
    }

    await reply('用法: `/profile` 查看 | `/profile set <字段> <值>` 设置 | `/profile clear` 清空', true);
    return true;
    },
};
