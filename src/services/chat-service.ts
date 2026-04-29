/**
 * chat-service.ts — File-based chat session and message persistence.
 *
 * Each user's chat data lives in stateDir/projects/:
 *   chat-sessions.json        ← session metadata index
 *   {sessionId}/chat-{sessionId}.jsonl  ← one JSON line per message
 *
 * Provides:
 *  - Session lifecycle: create, get current, close
 *  - Message persistence: add, list
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import { deriveChatTitleFromMessage } from '../utils/chat-title.js';
import { withGitAutoCommit } from '../utils/git-auto-commit.js';
import { parseJsonLines, parseJsonOr } from '../utils/json.js';
import { userGetStateDir } from './user-service.js';

// ── Path helpers ──────────────────────────────────────────────────────────────

function stateDirForUser(userId: string): string {
    const stateDir = userGetStateDir(userId);
    if (!stateDir) throw new Error(`No stateDir configured for user "${userId}"`);
    return stateDir;
}

function tmpDir(userId: string): string {
    const stateDir = stateDirForUser(userId);
    return join(stateDir, 'projects');
}

function sessionsFile(userId: string): string {
    return join(tmpDir(userId), 'chat-sessions.json');
}

function messagesFile(userId: string, sessionId: string): string {
    return join(tmpDir(userId), sessionId, `chat-${sessionId}.jsonl`);
}

function sessionDir(userId: string, sessionId: string): string {
    return join(tmpDir(userId), sessionId);
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionRow {
    id: string;
    user_id: string;
    title: string;
    start_time: string;
    end_time: string;
    is_current: number;
    is_pinned: number;
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

// ── Internal helpers ──────────────────────────────────────────────────────────

interface SessionsStore {
    sessions: Record<string, SessionRow>;
}

async function readSessionsStore(userId: string): Promise<SessionsStore> {
    try {
        const raw = await fs.readFile(sessionsFile(userId), 'utf8');
        return parseJsonOr<SessionsStore>(raw, { sessions: {} });
    } catch {
        return { sessions: {} };
    }
}

async function writeSessionsStore(userId: string, store: SessionsStore): Promise<void> {
    await fs.mkdir(tmpDir(userId), { recursive: true });
    await fs.writeFile(sessionsFile(userId), JSON.stringify(store, null, 2), 'utf8');
}

async function readMessages(userId: string, sessionId: string): Promise<MessageRow[]> {
    try {
        const raw = await fs.readFile(messagesFile(userId, sessionId), 'utf8');
        return parseJsonLines<MessageRow>(raw);
    } catch {
        return [];
    }
}

// ── Session operations ────────────────────────────────────────────────────────

export async function sessionGet(sessionId: string, userId: string): Promise<SessionRow | null> {
    const store = await readSessionsStore(userId);
    return store.sessions[sessionId] ?? null;
}

/** Return the current (is_current=1) session for a user, or null. */
export async function sessionGetCurrent(userId: string): Promise<SessionRow | null> {
    const store = await readSessionsStore(userId);
    const all = Object.values(store.sessions)
        .filter(s => s.is_current === 1)
        .sort((a, b) => b.start_time.localeCompare(a.start_time));
    return all[0] ?? null;
}

/** Create a new session and mark it as current (deactivates previous ones). */
export async function sessionCreate(userId: string, id?: string): Promise<SessionRow> {
    return withGitAutoCommit(stateDirForUser(userId), 'session_create', async () => {
        const store = await readSessionsStore(userId);
        const now = new Date().toISOString();
        id = id ?? generateId();

        for (const s of Object.values(store.sessions)) {
            if (s.is_current) s.is_current = 0;
        }

        const session: SessionRow = { id, user_id: userId, title: '', start_time: now, end_time: now, is_current: 1, is_pinned: 0 };
        store.sessions[id] = session;
        await writeSessionsStore(userId, store);
        return session;
    }, 'ChatService');
}

/** List recent sessions for a user. */
export async function sessionList(userId: string, limit = 20): Promise<SessionRow[]> {
    const store = await readSessionsStore(userId);
    return Object.values(store.sessions)
        .sort((a, b) => b.start_time.localeCompare(a.start_time))
        .slice(0, limit);
}

/** Patch a session's title and/or is_pinned. */
export async function sessionPatch(
    sessionId: string,
    userId: string,
    patch: { title?: string; is_pinned?: number },
): Promise<SessionRow | null> {
    return withGitAutoCommit(stateDirForUser(userId), 'session_patch', async () => {
        const store = await readSessionsStore(userId);
        const session = store.sessions[sessionId];
        if (!session) return null;
        if (patch.title !== undefined) session.title = patch.title;
        if (patch.is_pinned !== undefined) session.is_pinned = patch.is_pinned;
        await writeSessionsStore(userId, store);
        return session;
    }, 'ChatService');
}

/** Delete a session and all its messages. */
export async function sessionDelete(sessionId: string, userId: string): Promise<boolean> {
    return withGitAutoCommit(stateDirForUser(userId), 'session_delete', async () => {
        const store = await readSessionsStore(userId);
        if (!store.sessions[sessionId]) return false;
        delete store.sessions[sessionId];
        await writeSessionsStore(userId, store);
        await fs.rm(sessionDir(userId, sessionId), { recursive: true, force: true });
        return true;
    }, 'ChatService');
}

// ── Message operations ────────────────────────────────────────────────────────

/** Append a message to a session and update session end_time. */
export async function messageAdd(
    sessionId: string,
    userId: string,
    role: 'user' | 'assistant' | 'model',
    content: string,
    userName?: string,
): Promise<MessageRow> {
    return withGitAutoCommit(stateDirForUser(userId), 'message_add', async () => {
        const timestamp = new Date().toISOString();
        const existing = await readMessages(userId, sessionId);
        const msg: MessageRow = {
            id: existing.length + 1,
            session_id: sessionId,
            user_id: userId,
            role,
            content,
            user_name: userName ?? null,
            timestamp,
        };

        await fs.mkdir(tmpDir(userId), { recursive: true });
        await fs.mkdir(join(tmpDir(userId), sessionId), { recursive: true });
        await fs.appendFile(messagesFile(userId, sessionId), JSON.stringify(msg) + '\n', 'utf8');

        const store = await readSessionsStore(userId);
        if (store.sessions[sessionId]) {
            store.sessions[sessionId].end_time = timestamp;
            // Auto-title from first user message
            if (role === 'user' && !store.sessions[sessionId].title && existing.length === 0) {
                store.sessions[sessionId].title = deriveChatTitleFromMessage(content);
            }
            await writeSessionsStore(userId, store);
        }

        return msg;
    }, 'ChatService');
}

/** List messages for a session, oldest first. */
export async function messageList(sessionId: string, userId: string, limit = 200): Promise<MessageRow[]> {
    const msgs = await readMessages(userId, sessionId);
    return msgs.slice(-limit);
}
