import type { UserProfileManager } from '../lib/user-profile.js';

interface ProfileDeps {
    userProfile: UserProfileManager;
}

export async function tryHandleProfileCommand(
    command: string,
    text: string,
    ctx: any,
    deps: ProfileDeps,
): Promise<boolean> {
    if (command !== '/profile') return false;

    const args = text.split(' ').slice(1);
    const sub = args[0];

    if (!sub || sub === 'show') {
        await ctx.reply(
            `👤 **个人信息**\n\n${deps.userProfile.toDisplayString()}`,
            { parse_mode: 'Markdown' }
        );
        return true;
    }

    if (sub === 'clear') {
        await deps.userProfile.clear();
        await ctx.reply('✅ 个人信息已清空。');
        return true;
    }

    if (sub === 'set') {
        const field = args[1];
        const value = args.slice(2).join(' ');
        if (!field || !value) {
            await ctx.reply(
                '用法:\n' +
                '`/profile set name 你的名字`\n' +
                '`/profile set city 所在城市`\n' +
                '`/profile set timezone Asia/Shanghai`\n' +
                '`/profile set language 中文`\n' +
                '`/profile set interests 科技,投资,健身`\n' +
                '`/profile set notes 自由描述，如职业、习惯等`',
                { parse_mode: 'Markdown' }
            );
            return true;
        }

        const allowed = ['name', 'city', 'timezone', 'language', 'interests', 'notes'];
        if (!allowed.includes(field)) {
            await ctx.reply(`❌ 不支持的字段 \`${field}\`，可用: ${allowed.join(', ')}`, { parse_mode: 'Markdown' });
            return true;
        }

        const patch: any = field === 'interests'
            ? { interests: value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }
            : { [field]: value };
        await deps.userProfile.update(patch);
        await ctx.reply(`✅ 已更新 ${field}。\n\n${deps.userProfile.toDisplayString()}`, { parse_mode: 'Markdown' });
        return true;
    }

    await ctx.reply('用法: `/profile` 查看 | `/profile set <字段> <值>` 设置 | `/profile clear` 清空', { parse_mode: 'Markdown' });
    return true;
}
