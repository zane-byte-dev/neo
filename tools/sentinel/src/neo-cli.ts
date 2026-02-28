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
import { runCurator } from './lib/tools/curator.js';
import { runMaintenance } from './lib/tools/butler.js';

async function main() {
    const client = new GeminiClient();
    if (!client.isEnabled()) {
        console.error("❌ Neo CLI 初始化失败。请确保 .env 中含有 GEMINI_API_KEY 与 GEMINI_WORK_DIR");
        process.exit(1);
    }

    const args = process.argv.slice(2);

    // 策展模式 (Curate mode)
    if (args[0] === 'curate') {
        try {
            console.log(`[Neo] 🕰️  召唤策展人中...\n`);
            const startTime = Date.now();
            const response = await runCurator();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

            console.log("=========================================\n");
            console.log(response);
            console.log(`\n========================================= (⏱️  ${elapsed}s)`);
        } catch (e: any) {
            console.error("🔥 策展异常:", e.message || e);
            process.exit(1);
        }
        return;
    }

    // 管家维护模式 (Butler mode)
    if (args[0] === 'butler') {
        try {
            console.log(`[Neo] 🤖 管家巡检中...\n`);
            const startTime = Date.now();
            const response = await runMaintenance();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

            console.log("=========================================\n");
            console.log(response);
            console.log(`\n========================================= (⏱️  ${elapsed}s)`);
        } catch (e: any) {
            console.error("🔥 管家异常:", e.message || e);
            process.exit(1);
        }
        return;
    }

    // Skill 执行模式 (Run mode)
    if (args[0] === 'run' && args.length >= 2) {
        const skillName = args[1];
        const skillArgs = args.slice(2);

        try {
            console.log(`[Neo] 💭 技能 [${skillName}] 执行中...\n`);
            const startTime = Date.now();

            const response = await client.runSkill(skillName, skillArgs);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

            console.log("=========================================\n");
            if (response) {
                console.log(response);
            } else {
                console.log("⚠️ （技能执行无返回数据或技能不存在）");
            }
            console.log(`\n========================================= (⏱️  ${elapsed}s)`);
        } catch (e: any) {
            console.error("🔥 技能执行异常:", e.message || e);
            process.exit(1);
        }
        return;
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
