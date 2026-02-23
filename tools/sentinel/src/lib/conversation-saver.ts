import { config } from 'dotenv';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Load environment variables
config();

const CONVERSATION_SAVE_DIR = process.env.CONVERSATION_SAVE_DIR;
const GEMINI_WORK_DIR = process.env.GEMINI_WORK_DIR;
const CONVERSATION_SAVE_ENABLED = process.env.CONVERSATION_SAVE_ENABLED !== 'false'; // Default true

/**
 * 会话逐字实录保存器 (Verbatim Transcript Saver)
 *
 * 保存路径优先级：
 *   1. CONVERSATION_SAVE_DIR（显式配置）
 *   2. GEMINI_WORK_DIR/01_日记/会话/（从 vault 自动推导）
 *   3. 禁用
 *
 * 格式：每天一个 Markdown 文件，按时间追加对话记录（逐字实录）。
 * 文件名：YYYY-MM-DD-会话实录.md
 */
export class ConversationSaver {
    private saveDir: string | undefined;
    private enabled: boolean;

    constructor() {
        // Resolve save directory
        if (CONVERSATION_SAVE_DIR) {
            this.saveDir = CONVERSATION_SAVE_DIR;
        } else if (GEMINI_WORK_DIR) {
            this.saveDir = join(GEMINI_WORK_DIR, '01_日记', '会话');
        }

        this.enabled = CONVERSATION_SAVE_ENABLED && !!this.saveDir;

        if (this.enabled && this.saveDir) {
            console.log(`[ConversationSaver] ✅ Enabled (Verbatim Transcript mode)`);
            console.log(`[ConversationSaver] 📁 Save directory: ${this.saveDir}`);
        } else {
            console.log('[ConversationSaver] ⚠️  Disabled (GEMINI_WORK_DIR and CONVERSATION_SAVE_DIR both unset)');
        }
    }

    /**
     * Append a conversation turn to today's verbatim transcript file.
     * Creates the file with frontmatter if it doesn't exist yet.
     */
    async saveConversation(
        question: string,
        answer: string,
        userName: string = 'User'
    ): Promise<boolean> {
        if (!this.enabled || !this.saveDir) {
            return false;
        }

        try {
            await this.ensureDirectory(this.saveDir);

            const now = new Date();
            const dateStr = this.formatDate(now);
            const timeStr = this.formatTime(now);
            const filePath = join(this.saveDir, `${dateStr}-会话实录.md`);

            // Build the turn block (verbatim transcript format)
            const turnBlock = this.buildTurnBlock(question, answer, userName, timeStr);

            if (!existsSync(filePath)) {
                // Create new file with frontmatter header
                const header = this.buildFileHeader(dateStr);
                await writeFile(filePath, header + turnBlock, 'utf-8');
            } else {
                // Append to existing file
                const existing = await readFile(filePath, 'utf-8');
                await writeFile(filePath, existing + turnBlock, 'utf-8');
            }

            console.log(`[ConversationSaver] ✅ Appended to: ${dateStr}-会话实录.md`);
            return true;
        } catch (error) {
            console.error(`[ConversationSaver] ❌ Failed to save: ${error}`);
            return false;
        }
    }

    /**
     * Build YAML frontmatter + daily header for a new transcript file
     */
    private buildFileHeader(dateStr: string): string {
        return `---
date: ${dateStr}
source: Telegram Bot
tags: [日记, 会话实录, NeoAgent]
---

# ${dateStr} 会话实录

`;
    }

    /**
     * Build a single conversation turn block (verbatim transcript format)
     */
    private buildTurnBlock(
        question: string,
        answer: string,
        userName: string,
        timeStr: string
    ): string {
        return `---

**[${timeStr}] ${userName}**

${question}

**[NeoAgent]**

${answer}

`;
    }

    /**
     * Format date as YYYY-MM-DD
     */
    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Format time as HH:mm
     */
    private formatTime(date: Date): string {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    /**
     * Ensure directory exists
     */
    private async ensureDirectory(dir: string): Promise<void> {
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
            console.log(`[ConversationSaver] 📁 Created directory: ${dir}`);
        }
    }

    /**
     * Check if saver is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}

/**
 * Convenience function to create a conversation saver
 */
export function createConversationSaver(): ConversationSaver {
    return new ConversationSaver();
}
