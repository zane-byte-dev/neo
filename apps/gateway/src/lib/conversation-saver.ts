import { config } from 'dotenv';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Load environment variables
config();

const MEMORY_DIR = process.env.MEMORY_DIR || './history/memory';

export class ConversationSaver {
    private currentFile: string | null = null;

    constructor() {
        // We'll determine the file on save to handle date changes if the bot runs across midnight
    }

    /**
     * Get the memory file path fortoday
     */
    private getTodayFilePath(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const fileName = `${year}-${month}-${day}.md`;

        // Use GEMINI_WORK_DIR as base if available, else relative
        const baseDir = process.env.GEMINI_WORK_DIR || process.cwd();
        return join(baseDir, 'history/memory', fileName);
    }

    /**
     * Ensure the memory directory exists
     */
    private async ensureDirectory(filePath: string): Promise<void> {
        const dir = join(filePath, '..');
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }

    /**
     * Save a conversation turn to the daily memory file
     */
    async saveTurn(userName: string, question: string, neoResponse: string, sessionId?: string): Promise<void> {
        try {
            const filePath = this.getTodayFilePath();
            await this.ensureDirectory(filePath);

            const isNewFile = !existsSync(filePath);
            const now = new Date();
            const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

            let content = '';

            if (isNewFile) {
                const dateStr = now.toISOString().split('T')[0];
                content += `---\ndate: ${dateStr}\nsource: Telegram Bot\ntags: [日记, 会话实录, NeoAgent]\n---\n\n# ${dateStr} 会话实录\n\n`;
            }

            // Standard format as seen in 2026-03-06.md
            content += `## ${timeStr} 对话记录\n`;
            if (sessionId) {
                content += `<!-- session: ${sessionId} -->\n`;
            }
            content += `### User\n${question}\n\n`;

            // Format Neo's response with quotes if it's a "persona" style or just plain
            const lines = neoResponse.split('\n');
            const quotedResponse = lines.map(line => line.trim() ? `> ${line}` : `> `).join('\n');

            content += `### Neo\n${quotedResponse}\n\n\n`;

            await appendFile(filePath, content, 'utf-8');
            console.log(`[ConversationSaver] ✅ Saved turn to ${filePath}`);
        } catch (error) {
            console.error(`[ConversationSaver] ❌ Failed to save: ${error}`);
        }
    }
}
