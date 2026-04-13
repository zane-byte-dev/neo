import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * File-based user profile manager.
 *
 * All profile data lives in `{workDir}/USER.md` — a human-readable Markdown file
 * that the user (or AI) can edit directly. No DB storage needed.
 */
export class UserProfileManager {
    private workDir: string;

    constructor(workDir: string) {
        this.workDir = workDir;
    }

    private get filePath(): string {
        return join(this.workDir, 'USER.md');
    }

    async init(): Promise<void> {
        // Ensure USER.md exists with a template if missing
        try {
            await fs.access(this.filePath);
        } catch {
            await fs.writeFile(this.filePath, '# 用户档案\n\n- 姓名: \n- 城市: \n- 时区: Asia/Shanghai\n- 语言偏好: 中文\n', 'utf8');
        }
    }

    /** Read the raw USER.md content */
    async read(): Promise<string> {
        try {
            return await fs.readFile(this.filePath, 'utf8');
        } catch {
            return '';
        }
    }

    /** Overwrite USER.md with new content */
    async write(content: string): Promise<void> {
        await fs.writeFile(this.filePath, content, 'utf8');
    }

    /** Build context string for AI system prompt */
    async toContextString(): Promise<string> {
        const content = await this.read();
        if (content.trim()) return `[用户档案]\n${content.trim()}`;
        return '';
    }

    /** Format for /profile display */
    async toDisplayString(): Promise<string> {
        const content = await this.read();
        if (!content.trim()) {
            return '（暂无个人信息，直接编辑 workspace 下的 `USER.md` 文件）';
        }
        return content.trim();
    }
}
