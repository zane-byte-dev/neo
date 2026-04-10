/**
 * chat-service.ts — Business logic for chat_sessions and chat_messages tables.
 *
 * Provides:
 *  - Session lifecycle: create, get current, close
 *  - Message persistence: add, list
 *  - LLM integration: getGeminiHistory() returns GeminiContent[] for context
 *  - ChatSession helper: per-user stateful wrapper matching the legacy cache API
 */
import { getDb } from './db.js';
import { generateId } from '../utils/id-generator.js';
import type { GeminiContent } from '../llm/types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionRow {
    id: string;
    user_id: string;
    start_time: string;
    end_time: string;
    is_current: number;
}

export interface MessageRow {
    id: number;
    session_id: string;
    user_id: string;
    role: string;
    content: string;
    user_name: string | null;
    timestamp: string;
}

// ── Session operations ────────────────────────────────────────────────────────

export function sessionGet(sessionId: string, userId: string): SessionRow | null {
    return (getDb().prepare(
        `SELECT id, user_id, start_time, end_time, is_current
         FROM chat_sessions WHERE id = ? AND user_id = ?`
    ).get(sessionId, userId) ?? null) as SessionRow | null;
}

/** Return the current (is_current=1) session for a user, or null. */
export function sessionGetCurrent(userId: string): SessionRow | null {
    return (getDb().prepare(
        `SELECT id, user_id, start_time, end_time, is_current
         FROM chat_sessions WHERE user_id = ? AND is_current = 1
         ORDER BY start_time DESC LIMIT 1`
    ).get(userId) ?? null) as SessionRow | null;
}

/** Create a new session and mark it as current (deactivates previous ones). */
export function sessionCreate(userId: string, id?: string): SessionRow {
    const db = getDb();
    id = id ?? generateId();
    const now = new Date().toISOString();

    // Deactivate existing current session
    db.prepare(`UPDATE chat_sessions SET is_current = 0 WHERE user_id = ? AND is_current = 1`).run(userId);

    db.prepare(
        `INSERT INTO chat_sessions (id, user_id, start_time, end_time, is_current)
         VALUES (?, ?, ?, ?, 1)`
    ).run(id, userId, now, now);

    return { id, user_id: userId, start_time: now, end_time: now, is_current: 1 };
}

/** Get the current session, or create one if none exists. */
export function sessionGetOrCreate(userId: string): SessionRow {
    return sessionGetCurrent(userId) ?? sessionCreate(userId);
}

/** Mark a session as closed (is_current=0) and update end_time. */
export function sessionClose(sessionId: string): void {
    getDb().prepare(
        `UPDATE chat_sessions SET is_current = 0, end_time = ? WHERE id = ?`
    ).run(new Date().toISOString(), sessionId);
}

/** List recent sessions for a user. */
export function sessionList(userId: string, limit = 20): SessionRow[] {
    return getDb().prepare(
        `SELECT id, user_id, start_time, end_time, is_current
         FROM chat_sessions WHERE user_id = ?
         ORDER BY start_time DESC LIMIT ?`
    ).all(userId, limit) as SessionRow[];
}

/** Delete a session and all its messages (CASCADE). */
export function sessionDelete(sessionId: string, userId: string): boolean {
    const result = getDb().prepare(
        `DELETE FROM chat_sessions WHERE id = ? AND user_id = ?`
    ).run(sessionId, userId);
    return result.changes > 0;
}

// ── Message operations ────────────────────────────────────────────────────────

/** Append a message to a session and update session end_time. */
export function messageAdd(
    sessionId: string,
    userId: string,
    role: 'user' | 'assistant' | 'model',
    content: string,
    userName?: string,
): MessageRow {
    const db = getDb();
    const timestamp = new Date().toISOString();

    const row = db.transaction(() => {
        const result = db.prepare(
            `INSERT INTO chat_messages (session_id, user_id, role, content, user_name, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(sessionId, userId, role, content, userName ?? null, timestamp);

        // Keep end_time in sync
        db.prepare(`UPDATE chat_sessions SET end_time = ? WHERE id = ?`).run(timestamp, sessionId);

        return {
            id: result.lastInsertRowid as number,
            session_id: sessionId,
            user_id: userId,
            role,
            content,
            user_name: userName ?? null,
            timestamp,
        };
    })();

    return row;
}

/** List messages for a session, oldest first. */
export function messageList(sessionId: string, limit = 200): MessageRow[] {
    return getDb().prepare(
        `SELECT id, session_id, user_id, role, content, user_name, timestamp
         FROM chat_messages WHERE session_id = ?
         ORDER BY id ASC LIMIT ?`
    ).all(sessionId, limit) as MessageRow[];
}

/** Delete a single message. */
export function messageDelete(id: number, userId: string): boolean {
    const result = getDb().prepare(
        `DELETE FROM chat_messages WHERE id = ? AND user_id = ?`
    ).run(id, userId);
    return result.changes > 0;
}

// ── LLM integration ───────────────────────────────────────────────────────────

/**
 * Return messages for a session formatted as GeminiContent[].
 * Gemini expects alternating user/model turns; consecutive same-role messages
 * are merged into one turn.
 */
export function getGeminiHistory(sessionId: string, limit = 100): GeminiContent[] {
    const rows = messageList(sessionId, limit);
    const contents: GeminiContent[] = [];

    for (const row of rows) {
        const role = row.role === 'assistant' ? 'model' : 'user';
        const last = contents[contents.length - 1];
        if (last && last.role === role) {
            // Merge into previous turn
            last.parts.push({ text: row.content });
        } else {
            contents.push({ role, parts: [{ text: row.content }] });
        }
    }

    return contents;
}

