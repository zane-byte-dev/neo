import { config } from 'dotenv';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Load environment variables
config();

const CHAT_CACHE_DIR = process.env.CHAT_CACHE_DIR || './cache';
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

interface Message {
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

interface ChatHistory {
    sessions: Session[];
    currentSessionId: string | null;
}

export class ChatHistoryCache {
    private cacheDir: string;
    private cacheFile: string;
    private history: ChatHistory;
    private currentSession: Session | null = null;
    private sessionTimeoutMs: number;
    private maxHistoryMessages: number;
    private onSessionExpire?: (session: Session) => Promise<void>;

    constructor() {
        this.cacheDir = CHAT_CACHE_DIR;
        this.cacheFile = join(this.cacheDir, 'chat_history.json');
        this.sessionTimeoutMs = CHAT_SESSION_TIMEOUT_HOURS * 60 * 60 * 1000;
        this.maxHistoryMessages = CHAT_MAX_HISTORY_MESSAGES;

        this.history = {
            sessions: [],
            currentSessionId: null,
        };
    }

    /**
     * Initialize cache: load from file or create new. Must be awaited before use.
     */
    async init() {
        try {
            await this.ensureDirectory();
            await this.loadFromFile();

            // Restore current session
            if (this.history.currentSessionId) {
                this.currentSession = this.history.sessions.find(
                    (s) => s.sessionId === this.history.currentSessionId
                ) || null;
            }

            console.log('[ChatHistoryCache] ✅ Initialized');
            console.log(`[ChatHistoryCache] 📁 Cache file: ${this.cacheFile}`);
            console.log(`[ChatHistoryCache] ⏱️  Session timeout: ${CHAT_SESSION_TIMEOUT_HOURS}h`);
            console.log(`[ChatHistoryCache] 📝 Total sessions: ${this.history.sessions.length}`);

            if (this.currentSession) {
                console.log(`[ChatHistoryCache] 🔄 Current session: ${this.currentSession.sessionId} (${this.currentSession.messages.length} messages)`);
            }
        } catch (error) {
            console.error(`[ChatHistoryCache] ❌ Init failed: ${error}`);
        }
    }

    /**
     * Register a callback that fires when a session expires (idle timeout exceeded).
     * The expired session object is passed — use it to archive to history/memory/.
     */
    setOnSessionExpire(cb: (session: Session) => Promise<void>): void {
        this.onSessionExpire = cb;
    }

    /**
     * Add a message to the current session
     */
    async addMessage(
        role: 'user' | 'assistant',
        content: string,
        userName?: string
    ): Promise<void> {
        // Check if we need a new session
        if (this.shouldCreateNewSession()) {
            // Fire expire callback for the outgoing session before rotating
            if (this.currentSession && this.currentSession.messages.length > 0 && this.onSessionExpire) {
                const expiredSession = { ...this.currentSession, messages: [...this.currentSession.messages] };
                this.onSessionExpire(expiredSession).catch(err =>
                    console.error('[ChatHistoryCache] onSessionExpire error:', err.message)
                );
            }
            await this.createNewSession();
        }

        const message: Message = {
            role,
            content,
            userName,
            timestamp: new Date().toISOString(),
        };

        this.currentSession!.messages.push(message);
        this.currentSession!.endTime = message.timestamp;

        // Trim history if needed
        this.trimHistory();

        // Save to file
        await this.saveToFile();

        console.log(`[ChatHistoryCache] ➕ Added ${role} message (session: ${this.currentSession!.sessionId})`);
    }

    /**
     * Get current session history for context
     */
    getCurrentSessionHistory(): Message[] {
        if (!this.currentSession) {
            return [];
        }
        return this.currentSession.messages;
    }

    /**
     * Format conversation history for Gemini context.
     * Applies a token budget (chars / 4 ≈ tokens) so the context string
     * never exceeds CHAT_MAX_CONTEXT_TOKENS, dropping oldest messages first.
     */
    getContextForGemini(): string {
        const messages = this.getCurrentSessionHistory();

        if (messages.length === 0) {
            return '';
        }

        // Start with the most recent messages subset
        const recentMessages = messages.slice(-this.maxHistoryMessages);

        // Format each message
        const formatted = recentMessages.map((msg) => {
            if (msg.role === 'user') {
                const userLabel = msg.userName ?? 'User';
                return `${userLabel}: ${msg.content}`;
            } else {
                return `Assistant: ${msg.content}`;
            }
        });

        // Apply token budget: drop from the front until within budget
        const maxChars = CHAT_MAX_CONTEXT_TOKENS * 4;
        let totalChars = formatted.reduce((sum, s) => sum + s.length, 0);
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

    /**
     * Create a new session
     */
    async createNewSession(): Promise<void> {
        const now = new Date();
        const sessionId = `session_${now.toISOString().replace(/[:.]/g, '-')}`;

        this.currentSession = {
            sessionId,
            startTime: now.toISOString(),
            endTime: now.toISOString(),
            messages: [],
        };

        this.history.sessions.push(this.currentSession);
        this.history.currentSessionId = sessionId;

        await this.saveToFile();

        console.log(`[ChatHistoryCache] 🆕 New session created: ${sessionId}`);
    }

    /**
     * Check if we should create a new session
     */
    private shouldCreateNewSession(): boolean {
        if (!this.currentSession) {
            return true;
        }

        // Use last message time (endTime) instead of session start time
        // This prevents breaking long active conversations
        const lastActivityTime = new Date(this.currentSession.endTime).getTime();
        const idleDuration = Date.now() - lastActivityTime;

        return idleDuration > this.sessionTimeoutMs;
    }

    /**
     * Trim history to keep message count under limit
     */
    private trimHistory(): void {
        if (!this.currentSession) {
            return;
        }

        const messages = this.currentSession.messages;
        if (messages.length > this.maxHistoryMessages) {
            const removeCount = messages.length - this.maxHistoryMessages;
            this.currentSession.messages = messages.slice(removeCount);
            console.log(`[ChatHistoryCache] ✂️  Trimmed ${removeCount} old messages`);
        }
    }

    /**
     * Clear all history
     */
    async clearHistory(): Promise<void> {
        this.history = {
            sessions: [],
            currentSessionId: null,
        };
        this.currentSession = null;

        await this.saveToFile();

        console.log('[ChatHistoryCache] 🗑️  History cleared');
    }

    /**
     * Save history to file
     */
    private async saveToFile(): Promise<void> {
        try {
            const json = JSON.stringify(this.history, null, 2);
            await writeFile(this.cacheFile, json, 'utf-8');
        } catch (error) {
            console.error(`[ChatHistoryCache] ❌ Failed to save: ${error}`);
        }
    }

    /**
     * Load history from file
     */
    private async loadFromFile(): Promise<void> {
        if (!existsSync(this.cacheFile)) {
            console.log('[ChatHistoryCache] 📄 No existing cache file, starting fresh');
            return;
        }

        try {
            const json = await readFile(this.cacheFile, 'utf-8');
            this.history = JSON.parse(json);
            console.log(`[ChatHistoryCache] ✅ Loaded ${this.history.sessions.length} sessions from cache`);
        } catch (error) {
            console.error(`[ChatHistoryCache] ❌ Failed to load cache: ${error}`);
            console.log('[ChatHistoryCache] 🔄 Starting with fresh history');
        }
    }

    /**
     * Ensure cache directory exists
     */
    private async ensureDirectory(): Promise<void> {
        if (!existsSync(this.cacheDir)) {
            await mkdir(this.cacheDir, { recursive: true });
            console.log(`[ChatHistoryCache] 📁 Created cache directory: ${this.cacheDir}`);
        }
    }

    /**
     * Get session statistics
     */
    getStats(): { totalSessions: number; currentMessages: number; sessionId: string | null } {
        return {
            totalSessions: this.history.sessions.length,
            currentMessages: this.currentSession?.messages.length || 0,
            sessionId: this.currentSession?.sessionId || null,
        };
    }
}

/**
 * Convenience function to create a chat history cache
 */
export function createChatHistoryCache(): ChatHistoryCache {
    return new ChatHistoryCache();
}
