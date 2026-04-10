import type Database from 'better-sqlite3';
import { getDb } from './db.js';

const CHAT_SESSION_TIMEOUT_HOURS = parseInt(
    process.env.CHAT_SESSION_TIMEOUT_HOURS || '1',
    10
);
const CHAT_MAX_HISTORY_MESSAGES = parseInt(
    process.env.CHAT_MAX_HISTORY_MESSAGES || '20',
    10
);
// ~4 chars per token; 3000 tokens leaves room for Persona + system context + response
const CHAT_MAX_CONTEXT_TOKENS = parseInt(
    process.env.CHAT_MAX_CONTEXT_TOKENS || '3000',
    10
);

export interface Message {
    role: 'user' | 'assistant';
    content: string;
    userName?: string;
    timestamp: string;
}

export interface Session {
    sessionId: string;
    startTime: string;
    endTime: string;
    messages: Message[];
}

export class ChatHistoryCache {
    private db: Database.Database;
    /** Scope key — the resolved userId, shared across all tenants of the same user */
    private userId: string;
    private currentSessionId: string | null = null;
    private sessionTimeoutMs: number;
    private maxHistoryMessages: number;
    private onSessionExpire?: (session: Session) => Promise<void>;

    constructor(userId: string) {
        this.db = getDb();
        this.userId = userId;
        this.sessionTimeoutMs = CHAT_SESSION_TIMEOUT_HOURS * 60 * 60 * 1000;
        this.maxHistoryMessages = CHAT_MAX_HISTORY_MESSAGES;
        // no async state in constructor — all reads happen lazily via DB
    }

    async init(): Promise<void> {
        // Restore current session pointer from DB
        const row = this.db.prepare(
            `SELECT id FROM chat_sessions WHERE tenant_key = ? AND is_current = 1`
        ).get(this.userId) as { id: string } | undefined;
        this.currentSessionId = row?.id ?? null;

        const total = (this.db.prepare(
            `SELECT COUNT(*) as n FROM chat_sessions WHERE tenant_key = ?`
        ).get(this.userId) as { n: number }).n;

        const tag = `[ChatHistoryCache|${this.userId}]`;
        console.log(`${tag} ✅ Initialized (SQLite)`);
        console.log(`${tag} ⏱️  Session timeout: ${CHAT_SESSION_TIMEOUT_HOURS}h`);
        console.log(`${tag} 📝 Total sessions: ${total}`);
        if (this.currentSessionId) {
            const msgCount = (this.db.prepare(
                `SELECT COUNT(*) as n FROM chat_messages WHERE session_id = ?`
            ).get(this.currentSessionId) as { n: number }).n;
            console.log(`${tag} 🔄 Current session: ${this.currentSessionId} (${msgCount} messages)`);
        }
    }

    async addMessage(role: 'user' | 'assistant', content: string, userName?: string): Promise<void> {
        if (this.shouldCreateNewSession()) {
            if (this.currentSessionId && this.onSessionExpire) {
                const expiredSession = this.buildSession(this.currentSessionId);
                if (expiredSession && expiredSession.messages.length > 0) {
                    this.onSessionExpire(expiredSession).catch(err =>
                        console.error('[ChatHistoryCache] onSessionExpire error:', err.message)
                    );
                }
            }
            await this.createNewSession();
        }

        const timestamp = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO chat_messages (session_id, tenant_key, role, content, user_name, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(this.currentSessionId, this.userId, role, content, userName ?? null, timestamp);

        // Update session end_time
        this.db.prepare(
            `UPDATE chat_sessions SET end_time = ? WHERE id = ?`
        ).run(timestamp, this.currentSessionId);

        // Trim oldest messages if over limit
        const count = (this.db.prepare(
            `SELECT COUNT(*) as n FROM chat_messages WHERE session_id = ?`
        ).get(this.currentSessionId) as { n: number }).n;
        if (count > this.maxHistoryMessages) {
            const excess = count - this.maxHistoryMessages;
            this.db.prepare(
                `DELETE FROM chat_messages WHERE id IN (
                    SELECT id FROM chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT ?
                 )`
            ).run(this.currentSessionId, excess);
            console.log(`[ChatHistoryCache] ✂️  Trimmed ${excess} old messages`);
        }

        console.log(`[ChatHistoryCache] ➕ Added ${role} message (session: ${this.currentSessionId})`);
    }

    getCurrentSessionHistory(): Message[] {
        if (!this.currentSessionId) return [];
        const rows = this.db.prepare(
            `SELECT role, content, user_name, timestamp FROM chat_messages
             WHERE session_id = ? ORDER BY id ASC`
        ).all(this.currentSessionId) as Array<{ role: string; content: string; user_name: string | null; timestamp: string }>;
        return rows.map(r => ({
            role: r.role as 'user' | 'assistant',
            content: r.content,
            userName: r.user_name ?? undefined,
            timestamp: r.timestamp,
        }));
    }

    getContextForGemini(): string {
        const messages = this.getCurrentSessionHistory();
        if (messages.length === 0) return '';

        const recent = messages.slice(-this.maxHistoryMessages);
        const formatted = recent.map(msg =>
            msg.role === 'user'
                ? `${msg.userName ?? 'User'}: ${msg.content}`
                : `Assistant: ${msg.content}`
        );

        const maxChars = CHAT_MAX_CONTEXT_TOKENS * 4;
        let totalChars = formatted.reduce((s, x) => s + x.length, 0);
        let start = 0;
        while (totalChars > maxChars && start < formatted.length - 1) {
            totalChars -= formatted[start].length;
            start++;
        }
        if (start > 0) {
            console.log(`[ChatHistoryCache] ✂️  Token budget hit: dropped ${start} oldest messages`);
        }
        return formatted.slice(start).join('\n\n');
    }

    async createNewSession(): Promise<void> {
        const now = new Date();
        const sessionId = `session_${now.toISOString().replace(/[:.]/g, '-')}`;
        const iso = now.toISOString();

        // Mark old current session as not current
        this.db.prepare(
            `UPDATE chat_sessions SET is_current = 0 WHERE tenant_key = ? AND is_current = 1`
        ).run(this.userId);

        this.db.prepare(
            `INSERT INTO chat_sessions (id, tenant_key, start_time, end_time, is_current) VALUES (?, ?, ?, ?, 1)`
        ).run(sessionId, this.userId, iso, iso);

        this.currentSessionId = sessionId;
        console.log(`[ChatHistoryCache] 🆕 New session created: ${sessionId}`);
    }

    async compactWithSummary(summary: string): Promise<void> {
        if (!this.currentSessionId) return;
        const now = new Date().toISOString();
        this.db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(this.currentSessionId);
        this.db.prepare(
            `INSERT INTO chat_messages (session_id, tenant_key, role, content, user_name, timestamp)
             VALUES (?, ?, 'assistant', ?, NULL, ?)`
        ).run(this.currentSessionId, this.userId, `[对话摘要]\n${summary}`, now);
        this.db.prepare(`UPDATE chat_sessions SET end_time = ? WHERE id = ?`).run(now, this.currentSessionId);
        console.log('[ChatHistoryCache] 🗜️  Session compacted with summary');
    }

    async clearHistory(): Promise<void> {
        this.db.prepare(`DELETE FROM chat_sessions WHERE tenant_key = ?`).run(this.userId);
        this.currentSessionId = null;
        console.log('[ChatHistoryCache] 🗑️  History cleared');
    }

    getStats(): { totalSessions: number; currentMessages: number; sessionId: string | null } {
        const total = (this.db.prepare(
            `SELECT COUNT(*) as n FROM chat_sessions WHERE tenant_key = ?`
        ).get(this.userId) as { n: number }).n;
        const currentMessages = this.currentSessionId
            ? (this.db.prepare(
                `SELECT COUNT(*) as n FROM chat_messages WHERE session_id = ?`
              ).get(this.currentSessionId) as { n: number }).n
            : 0;
        return { totalSessions: total, currentMessages, sessionId: this.currentSessionId };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private shouldCreateNewSession(): boolean {
        if (!this.currentSessionId) return true;
        const row = this.db.prepare(
            `SELECT end_time FROM chat_sessions WHERE id = ?`
        ).get(this.currentSessionId) as { end_time: string } | undefined;
        if (!row) return true;
        const idleDuration = Date.now() - new Date(row.end_time).getTime();
        return idleDuration > this.sessionTimeoutMs;
    }

    private buildSession(sessionId: string): Session | null {
        const sRow = this.db.prepare(
            `SELECT id, start_time, end_time FROM chat_sessions WHERE id = ?`
        ).get(sessionId) as { id: string; start_time: string; end_time: string } | undefined;
        if (!sRow) return null;
        const rows = this.db.prepare(
            `SELECT role, content, user_name, timestamp FROM chat_messages WHERE session_id = ? ORDER BY id ASC`
        ).all(sessionId) as Array<{ role: string; content: string; user_name: string | null; timestamp: string }>;
        return {
            sessionId: sRow.id,
            startTime: sRow.start_time,
            endTime: sRow.end_time,
            messages: rows.map(r => ({
                role: r.role as 'user' | 'assistant',
                content: r.content,
                userName: r.user_name ?? undefined,
                timestamp: r.timestamp,
            })),
        };
    }
}

// ── Standalone query (for tools that don't hold a ChatHistoryCache instance) ──

export interface ChatMessageRow {
    role: string;
    content: string;
    user_name: string | null;
    timestamp: string;
}

export function getChatHistory(userId: string, date: string, limit: number): ChatMessageRow[] {
    return getDb().prepare(
        `SELECT m.role, m.content, m.user_name, m.timestamp
         FROM chat_messages m
         JOIN chat_sessions s ON m.session_id = s.id
         WHERE m.tenant_key = ? AND m.timestamp LIKE ?
         ORDER BY m.id ASC
         LIMIT ?`
    ).all(userId, `${date}%`, limit) as ChatMessageRow[];
}
