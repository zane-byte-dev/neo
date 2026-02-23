#!/usr/bin/env node
/**
 * 获取 Telegram Chat ID 工具
 * 运行后向 Bot 发送任意消息，即可在终端看到你的 Chat ID
 */

import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';

config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN missing in .env');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

console.log('🔍 Waiting for a message...');
console.log('   → Open Telegram and send any message to your Bot');
console.log('   → Your Chat ID will appear below\n');

bot.on(message('text'), (ctx) => {
    const chatId = ctx.chat.id;
    const userName = ('first_name' in ctx.chat ? ctx.chat.first_name : undefined) || 'Unknown';

    console.log('✅ Chat ID found!');
    console.log(`   Name    : ${userName}`);
    console.log(`   Chat ID : ${chatId}`);
    console.log(`\n📋 Add to your .env:`);
    console.log(`   TELEGRAM_CHAT_ID=${chatId}\n`);

    ctx.reply(`✅ Your Chat ID is: \`${chatId}\`\n\nAdd this to your .env file as:\nTELEGRAM_CHAT_ID=${chatId}`, {
        parse_mode: 'Markdown',
    });

    // Exit after getting the first chat ID
    setTimeout(() => {
        bot.stop();
        process.exit(0);
    }, 1000);
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
