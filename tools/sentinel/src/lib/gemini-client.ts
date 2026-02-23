import { config } from 'dotenv';
import { execa } from 'execa';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load environment variables
config();

const GEMINI_CLI_PATH = process.env.GEMINI_CLI_PATH || 'gemini';
const GEMINI_TIMEOUT = parseInt(process.env.GEMINI_TIMEOUT || '180', 10) * 1000; // Convert to ms
const GEMINI_WORK_DIR = process.env.GEMINI_WORK_DIR; // Optional working directory

// ==================== Persona Router ====================

/**
 * Persona 定义：关键词 → Persona 文件名（不含扩展名）
 */
const PERSONA_RULES: { keywords: string[]; file: string; name: string }[] = [
    {
        name: '🌋 Deep Builder',
        file: 'Persona_DeepBuilder',
        keywords: ['整理', '写文章', '哲学', '意义', '深度', '白皮书', '知识', '方法论', '框架', '系统性'],
    },
    {
        name: '🎩 西风 West Wind',
        file: 'Persona_WestWind',
        keywords: ['方向', '决策', '怎么看', '人性', '分析', '战略', '选择', '判断', '审视', '反思'],
    },
    {
        name: '🧢 Pieter Levels',
        file: 'Persona_PieterLevels',
        keywords: ['搞钱', '变现', 'mvp', 'MVP', '上线', '用户', '产品', '快速', '独立开发', '功能'],
    },
    {
        name: '⌨️ Torvalds',
        file: 'Persona_UncleTorvalds',
        keywords: ['写代码', '报错', '重构', '架构', '配置', 'bug', 'debug', '性能', '代码', '函数', '实现', '怎么写'],
    },
    {
        name: '🕰️ Curator',
        file: 'Persona_Curator',
        keywords: ['/pulse', '回顾', '灵感', '推荐', '随机', '漫步', '发现'],
    },
];

/**
 * 无触发词时的默认 Persona（fallback）
 * 设计选择：西风（West Wind）作为全能默认视角 ——
 * 日常聊天大多带有判断/分析色彩，且西风的 prompt 中有「优先使用中文」的明确指令。
 */
const DEFAULT_PERSONA = { file: 'Persona_WestWind', name: '🎩 西风 West Wind (default)' };

/**
 * 根据消息内容检测应使用的 Persona
 * 无匹配时返回 DEFAULT_PERSONA（而非 null）
 */
function detectPersona(message: string): { file: string; name: string } {
    const lower = message.toLowerCase();
    for (const rule of PERSONA_RULES) {
        if (rule.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
            return { file: rule.file, name: rule.name };
        }
    }
    return DEFAULT_PERSONA;
}

// ==================== GeminiClient ====================

export class GeminiClient {
    private enabled: boolean = false;
    private cliPath: string;
    private timeout: number;
    private workDir?: string;
    private systemContext: string = '';
    private personasDir?: string;

    constructor() {
        this.cliPath = GEMINI_CLI_PATH;
        this.timeout = GEMINI_TIMEOUT;
        this.workDir = GEMINI_WORK_DIR;

        if (this.checkCli()) {
            this.enabled = true;
            console.log(`[Gemini] ✅ Using CLI at: ${this.cliPath}`);
            if (this.workDir) {
                console.log(`[Gemini] 📂 Working directory: ${this.workDir}`);
                this.personasDir = join(this.workDir, '99_系统', 'Personas');
                this.loadSystemContext();
            }
            console.log('[Gemini] ⚠️  CLI mode can be slow (~17s per query)');
        } else {
            console.log('[Gemini] ❌ CLI not available');
            console.log('[Gemini] Please install Gemini CLI or check GEMINI_CLI_PATH');
        }
    }

    /**
     * Load base system context from GEMINI.md
     */
    private loadSystemContext() {
        if (!this.workDir) return;

        const locations = [
            join(this.workDir, '99_系统', 'GEMINI.md'),
            join(this.workDir, 'GEMINI.md'),
        ];

        for (const loc of locations) {
            if (existsSync(loc)) {
                try {
                    this.systemContext = readFileSync(loc, 'utf-8');
                    console.log(`[Gemini] ✅ Loaded system context from: ${loc}`);
                    return;
                } catch (err) {
                    console.warn(`[Gemini] ⚠️ Failed to read context from ${loc}: ${err}`);
                }
            }
        }

        console.log('[Gemini] ℹ️ No GEMINI.md context found. Using default.');
    }

    /**
     * Dynamically load a Persona's prompt file.
     * Returns empty string if not found.
     */
    private loadPersonaContext(file: string): string {
        if (!this.personasDir) return '';
        const loc = join(this.personasDir, `${file}.md`);
        if (!existsSync(loc)) {
            console.warn(`[Gemini] ⚠️ Persona file not found: ${loc}`);
            return '';
        }
        try {
            const content = readFileSync(loc, 'utf-8');
            console.log(`[Gemini] 🎭 Loaded persona: ${file}`);
            return content;
        } catch (err) {
            console.warn(`[Gemini] ⚠️ Failed to read persona ${file}: ${err}`);
            return '';
        }
    }

    /**
     * Check if Gemini CLI is available
     */
    private checkCli(): boolean {
        try {
            console.log(`[Gemini] Checking CLI at: ${this.cliPath}`);
            const result = spawnSync(this.cliPath, ['--help'], {
                timeout: 5000,
                encoding: 'utf-8',
            });
            console.log(`[Gemini] CLI check result - status: ${result.status}, error: ${result.error}`);
            if (result.error) {
                console.log(`[Gemini] CLI error details: ${result.error.message}`);
                return false;
            }
            return result.status === 0;
        } catch (error) {
            console.log(`[Gemini] CLI check exception: ${error}`);
            return false;
        }
    }

    /**
     * Call Gemini CLI to generate a response.
     * Optionally accepts a detected persona to inject.
     */
    async generateResponse(prompt: string, persona?: { file: string; name: string } | null): Promise<string | null> {
        if (!this.enabled) {
            return null;
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const weekday = new Date().toLocaleDateString('zh-CN', { weekday: 'long' });

            let fullPrompt = '';

            // 1. Base system context (GEMINI.md)
            if (this.systemContext) {
                fullPrompt += `[System Context]\n${this.systemContext}\n\n`;
            }

            // 2. Persona-specific context (dynamically loaded)
            if (persona) {
                const personaContent = this.loadPersonaContext(persona.file);
                if (personaContent) {
                    fullPrompt += `[Active Persona: ${persona.name}]\n${personaContent}\n\n`;
                }
            }

            // 3. Current time
            fullPrompt += `[Current Time]\nToday is ${today} (${weekday}).\n\n`;

            // 4. User query
            fullPrompt += `[User Query]\n${prompt}\n\n`;

            // 5. Output instructions
            fullPrompt += `[Instructions]\n(Important: Please respond in CHINESE (中文). Please EXECUTE the necessary tools and PRINT the final result/answer directly.)`;

            const args = ['run', fullPrompt, '-y', '--output-format', 'text'];

            console.log(`[Gemini] Executing: ${this.cliPath} run ... (prompt length: ${fullPrompt.length}, persona: ${persona?.name || 'default'})`);

            const { stdout, stderr, exitCode } = await execa(this.cliPath, args, {
                timeout: this.timeout,
                reject: false,
                cwd: this.workDir,
            });

            const cleanOutput = this.cleanOutput(stdout);

            if (!cleanOutput) {
                if (exitCode !== 0) {
                    return `⚠️ CLI Error: ${stderr.trim()}`;
                }
                return '⚠️ NeoAgent 似乎执行了操作，但没有返回文本结果。';
            }

            return cleanOutput;
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('timed out')) {
                    return `⏱️ Error: Thinking timed out (${this.timeout / 1000}s).`;
                }
                return `🔥 System Error: ${error.message}`;
            }
            return '🔥 Unknown error occurred';
        }
    }

    /**
     * Clean CLI output by removing noise
     */
    private cleanOutput(rawOutput: string): string {
        const noiseMarkers = [
            '[ERROR]',
            '[INFO]',
            'Loading extension',
            'YOLO mode',
            'Loaded cached',
            'Server \t',
            'Hook registry',
        ];

        const lines = rawOutput.split('\n');
        const cleanLines: string[] = [];

        for (const line of lines) {
            if (noiseMarkers.some((marker) => line.includes(marker))) {
                continue;
            }

            if (!line.trim()) {
                if (cleanLines.length > 0 && cleanLines[cleanLines.length - 1] !== '') {
                    cleanLines.push(line);
                }
                continue;
            }

            cleanLines.push(line);
        }

        return cleanLines.join('\n').trim();
    }

    /**
     * Chat with conversation context.
     * Auto-detects persona from the latest user message.
     */
    async chatWithContext(message: string, conversationHistory: string): Promise<string | null> {
        // Detect persona from the incoming user message
        const persona = detectPersona(message);
        if (persona) {
            console.log(`[Gemini] 🎭 Persona activated: ${persona.name}`);
        }

        let promptWithContext = message;
        if (conversationHistory && conversationHistory.trim()) {
            promptWithContext = `[Previous Conversation]\n${conversationHistory}\n\n[New Question]\n${message}`;
        }

        return this.generateResponse(promptWithContext, persona);
    }

    /**
     * Simple chat (no history context)
     */
    async chat(message: string, systemInstruction?: string): Promise<string | null> {
        const persona = detectPersona(message);
        return this.generateResponse(message, persona);
    }

    /**
     * Test the Gemini CLI connection
     */
    async testConnection(): Promise<boolean> {
        if (!this.enabled) {
            console.log('[Gemini] ❌ Client not configured');
            return false;
        }

        console.log('[Gemini] 🧪 Testing CLI connection...');
        const response = await this.generateResponse(
            "Hi! Please respond with 'OK' to confirm."
        );

        if (response && !response.startsWith('⚠️') && !response.startsWith('🔥')) {
            console.log('[Gemini] ✅ CLI test successful');
            console.log(`[Gemini] Response preview: ${response.substring(0, 100)}...`);
            return true;
        } else {
            console.log('[Gemini] ❌ CLI test failed');
            if (response) {
                console.log(`[Gemini] Error: ${response}`);
            }
            return false;
        }
    }

    /**
     * Check if the client is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}

/**
 * Convenience function to create a Gemini client
 */
export function createGeminiClient(): GeminiClient {
    return new GeminiClient();
}

// Test script when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('Testing Gemini Client...\n');

    const client = createGeminiClient();

    if (client.isEnabled()) {
        const startTime = Date.now();
        await client.testConnection();
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\n⏱️  Response time: ${elapsed.toFixed(2)}s`);
    } else {
        console.log('\n📝 Setup Instructions:');
        console.log('\nCLI Mode:');
        console.log('  1. Install Gemini CLI');
        console.log('  2. Add to .env: GEMINI_CLI_PATH=/path/to/gemini');
        console.log('  3. Optional: GEMINI_TIMEOUT=180');
    }
}
