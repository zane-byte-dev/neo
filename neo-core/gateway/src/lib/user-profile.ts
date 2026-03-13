import { promises as fs } from 'fs';
import { join } from 'path';

export interface UserProfile {
    name?: string;
    city?: string;
    timezone?: string;
    language?: string;
    interests?: string[];
    notes?: string;    // free-form extra context
    updatedAt?: number;
}

export class UserProfileManager {
    private profile: UserProfile = {};
    private dbPath: string;

    constructor(cacheDir: string) {
        this.dbPath = join(cacheDir, 'user_profile.json');
    }

    async init(): Promise<void> {
        try {
            const data = await fs.readFile(this.dbPath, 'utf8');
            this.profile = JSON.parse(data);
            console.log('[UserProfile] Loaded profile.');
        } catch (err: any) {
            if (err.code !== 'ENOENT') console.error('[UserProfile] Load error:', err.message);
        }
    }

    get(): UserProfile {
        return { ...this.profile };
    }

    async update(patch: Partial<UserProfile>): Promise<void> {
        this.profile = { ...this.profile, ...patch, updatedAt: Date.now() };
        await this.saveToDisk();
    }

    async clear(): Promise<void> {
        this.profile = {};
        await this.saveToDisk();
    }

    /**
     * Returns a compact context string to prepend to Gemini prompts.
     * Priority: $WORK_DIR/user.md (canonical source) → JSON fields fallback.
     */
    async toContextString(): Promise<string> {
        const workDir = process.env.WORK_DIR;
        if (workDir) {
            try {
                const userMd = await fs.readFile(join(workDir, 'user.md'), 'utf8');
                if (userMd.trim()) {
                    return `[用户档案]\n${userMd.trim()}`;
                }
            } catch {
                // user.md doesn't exist, fall through to JSON fields
            }
        }

        // Fallback: build from JSON fields
        const p = this.profile;
        const lines: string[] = [];
        if (p.name) lines.push(`用户姓名: ${p.name}`);
        if (p.city) lines.push(`所在城市: ${p.city}`);
        if (p.timezone) lines.push(`时区: ${p.timezone}`);
        if (p.language) lines.push(`偏好语言: ${p.language}`);
        if (p.interests?.length) lines.push(`兴趣/关注: ${p.interests.join('、')}`);
        if (p.notes) lines.push(`备注: ${p.notes}`);
        if (lines.length === 0) return '';
        return `[用户画像]\n${lines.join('\n')}`;
    }

    /**
     * Format profile for display in Telegram.
     */
    toDisplayString(): string {
        const p = this.profile;
        if (Object.keys(p).filter(k => k !== 'updatedAt').length === 0) {
            return '（暂无个人信息，用 /profile set 来设置）';
        }
        const lines: string[] = [];
        if (p.name) lines.push(`👤 姓名: ${p.name}`);
        if (p.city) lines.push(`📍 城市: ${p.city}`);
        if (p.timezone) lines.push(`🕐 时区: ${p.timezone}`);
        if (p.language) lines.push(`🗣 语言偏好: ${p.language}`);
        if (p.interests?.length) lines.push(`⭐ 兴趣: ${p.interests.join('、')}`);
        if (p.notes) lines.push(`📝 备注: ${p.notes}`);
        if (p.updatedAt) lines.push(`\n_更新于 ${new Date(p.updatedAt).toLocaleString('zh-CN')}_`);
        return lines.join('\n');
    }

    private async saveToDisk(): Promise<void> {
        try {
            await fs.writeFile(this.dbPath, JSON.stringify(this.profile, null, 2), 'utf8');
        } catch (err: any) {
            console.error('[UserProfile] Save error:', err.message);
        }
    }
}
