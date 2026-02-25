#!/usr/bin/env node

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as readline from 'readline';

// Load environment variables relative to the install directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../.env') });

import { GeminiClient } from './lib/gemini-client.js';

async function main() {
    const client = new GeminiClient();
    if (!client.isEnabled()) {
        console.error("❌ Neo CLI 初始化失败。请确保 .env 中含有 GEMINI_API_KEY 与 GEMINI_WORK_DIR");
        process.exit(1);
    }

    const args = process.argv.slice(2);

    // 如果没有参数，进入沉浸式交互模式
    if (args.length === 0) {
        console.log("=========================================");
        console.log("🤖 已进入 Neo 交互模式。输入 'exit' 退出。");
        console.log("   随时随地与知识库对接，享受极速原生体验。");
        console.log("=========================================\n");

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'Neo> '
        });

        // 保存历史上下文
        let sessionHistory = "";

        rl.prompt();

        rl.on('line', async (line) => {
            const input = line.trim();
            if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
                rl.close();
                return;
            }
            if (!input) {
                rl.prompt();
                return;
            }

            try {
                process.stdout.write(`\n[Neo] 💭 思考中...\n`);
                const startTime = Date.now();

                const response = await client.chatWithContext(input, sessionHistory);

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

                // 将光标移回上一行并清除“思考中...”
                readline.moveCursor(process.stdout, 0, -1);
                readline.clearLine(process.stdout, 0);

                if (response) {
                    console.log(`\x1b[36mNeo\x1b[0m:\n${response}`);
                    console.log(`\x1b[90m(⏱️  ${elapsed}s)\x1b[0m\n`);
                    // 追加历史，供模型联系上下文
                    sessionHistory += `\n[User]: ${input}\n[NeoAgent]: ${response}\n`;
                } else {
                    console.log("⚠️ （大模型无返回数据）\n");
                }
            } catch (e: any) {
                console.error("\n🔥 执行异常:", e.message || e, "\n");
            }
            rl.prompt();
        }).on('close', () => {
            console.log('\n再见！');
            process.exit(0);
        });

        return; // 进入事件循环，等待输入
    }

    // 单次执行模式 (Shot mode)
    const message = args.join(' ');

    try {
        console.log(`[Neo] 💭 思考中...\n`);
        const startTime = Date.now();

        const response = await client.chat(message);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log("=========================================\n");
        if (response) {
            console.log(response);
        } else {
            console.log("⚠️ （大模型无返回数据）");
        }
        console.log(`\n========================================= (⏱️  ${elapsed}s)`);

    } catch (e: any) {
        console.error("🔥 执行异常:", e.message || e);
        process.exit(1);
    }
}

main();
