import { promises as fs } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import type { TenantKey } from '../types/platform.js';

export interface UserProfile {
    name?: string;
    city?: string;
    timezone?: string;
    language?: string;
    interests?: string[];
    notes?: string;
    updatedAt?: number;
}

export class UserProfileManager {
    private db: Database.Database;
    private tenantKey: TenantKey;

    constructor(db: Database.Database, tenantKey: TenantKey) {
        this.db = db;
        this.tenantKey = tenantKey;
    }

    async init(): Promise<void> {
        console.log('[UserProfile] Ready (SQLite).');
    }

    get(): UserProfile {
        const row = this.db.prepare(
            `SELECT data FROM user_profile WHERE tenant_key = ?`
        ).get(this.tenantKey) as { data: string } | undefined;
        return row ? JSON.parse(row.data) : {};
    }

    async update(patch: Partial<UserProfile>): Promise<void> {
        const current = this.get();
        const next = { ...current, ...patch, updatedAt: Date.now() };
        this.db.prepare(
            `INSERT INTO user_profile (tenant_key, data, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(tenant_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
        ).run(this.tenantKey, JSON.stringify(next), Date.now());
    }

    async clear(): Promise<void> {
        this.db.prepare(`DELETE FROM user_profile WHERE tenant_key = ?`).run(this.tenantKey);
    }

    async toContextString(workDir?: string): Promise<string> {
        if (workDir) {
            try {
                const userMd = await fs.readFile(join(workDir, 'user.md'), 'utf8');
                if (userMd.trim()) return `[用户档案]\n${userMd.trim()}`;
            } catch { /* not found */ }
        }
        const p = this.get();
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

    toDisplayString(): string {
        const p = this.get();
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
}
