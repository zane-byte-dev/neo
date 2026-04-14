import { Telegraf } from 'telegraf';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../config.js';
import { runAgentTurn } from '../services/agent-runner.js';
import { userGetByTenant, userList } from '../services/user-service.js';
import { sessionCreate, sessionDelete, sessionGet } from '../services/chat-service.js';
import { log } from '../utils/logger.js';

const MODULE = 'Telegram';

const TELEGRAM_MAX_MESSAGE = 3800;

export interface TelegramRuntime {
    stop(): void;
}

// ── Markdown → Telegram HTML ──────────────────────────────────────────────────

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert common Markdown (as produced by LLMs) to Telegram-compatible HTML.
 * Handles: code blocks, inline code, bold, italic, strikethrough, links,
 * blockquotes, and headings. Unrecognized markup passes through escaped.
 */
function markdownToTelegramHtml(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code blocks
        const fenceMatch = line.match(/^```(\w*)/);
        if (fenceMatch) {
            const lang = fenceMatch[1];
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // skip closing ```
            const code = escapeHtml(codeLines.join('\n'));
            if (lang) {
                out.push(`<pre><code class="language-${lang}">${code}</code></pre>`);
            } else {
                out.push(`<pre>${code}</pre>`);
            }
            continue;
        }

        // Blockquote
        if (line.startsWith('> ')) {
            const quoteLines: string[] = [];
            while (i < lines.length && lines[i].startsWith('> ')) {
                quoteLines.push(lines[i].slice(2));
                i++;
            }
            out.push(`<blockquote>${inlineFormat(quoteLines.join('\n'))}</blockquote>`);
            continue;
        }

        // Heading → bold
        const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
        if (headingMatch) {
            out.push(`<b>${inlineFormat(headingMatch[1])}</b>`);
            i++;
            continue;
        }

        // Normal line
        out.push(inlineFormat(line));
        i++;
    }

    return out.join('\n');
}

/** Convert inline Markdown formatting to Telegram HTML */
function inlineFormat(text: string): string {
    // Escape HTML entities first, then apply formatting
    let s = escapeHtml(text);

    // Inline code (must be first to protect code content)
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold: **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/__(.+?)__/g, '<b>$1</b>');

    // Italic: *text* or _text_ (but not inside words with underscores)
    s = s.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
    s = s.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // Links: [text](url) — url was HTML-escaped, unescape &amp; back
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
        const cleanUrl = url.replace(/&amp;/g, '&');
        return `<a href="${cleanUrl}">${label}</a>`;
    });

    return s;
}

function splitTelegramText(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return ['(empty response)'];

    const parts: string[] = [];
    let rest = trimmed;
    while (rest.length > TELEGRAM_MAX_MESSAGE) {
        let cut = rest.lastIndexOf('\n', TELEGRAM_MAX_MESSAGE);
        if (cut < TELEGRAM_MAX_MESSAGE * 0.6) cut = TELEGRAM_MAX_MESSAGE;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    if (rest) parts.push(rest);
    return parts;
}

function resolveTelegramUserId(chatId: string): string | null {
    const byTenant = userGetByTenant(`telegram:${chatId}`);
    if (byTenant) return byTenant.id;

    const users = userList();
    const bySameId = users.find((u) => u.id === chatId);
    if (bySameId) return bySameId.id;

    if (TELEGRAM_CHAT_ID && TELEGRAM_CHAT_ID === chatId) {
        if (users.length === 1) return users[0].id;
    }

    return null;
}

export async function startTelegramBot(): Promise<TelegramRuntime | null> {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('[Telegram] TELEGRAM_BOT_TOKEN not set, skip startup');
        return null;
    }

    const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

    bot.start((ctx) => ctx.reply('Neo Telegram 已连接。发送 /new 可重置当前会话。'));

    bot.command('new', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = resolveTelegramUserId(chatId);
        if (!userId) {
            await ctx.reply('未授权：请在 space/config.json 的 users[].tenants 中配置 telegram:chatId。');
            return;
        }
        const sessionId = `tg-${chatId}`;
        await sessionDelete(sessionId, userId).catch(() => {});
        await sessionCreate(userId, sessionId);
        await ctx.reply('已开启新会话。');
    });

    bot.on('text', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = resolveTelegramUserId(chatId);
        if (!userId) {
            await ctx.reply('未授权：请在 space/config.json 的 users[].tenants 中配置 telegram:chatId。');
            return;
        }

        const cleanText = ctx.message.text.trim();
        if (!cleanText) return;

        const sessionId = `tg-${chatId}`;
        log.info(MODULE, 'Received message', { chatId, userId, sessionId, len: cleanText.length, preview: cleanText.slice(0, 80) });

        // 立即 sendChatAction 让用户看到"正在输入"，然后 fire-and-forget。
        // Telegraf 中间件有 90 秒超时限制，长任务（subagent/图像生成）必须脱离 handler 的
        // await 链，否则会触发 TimeoutError 并中断整个 update 处理流程。
        await ctx.sendChatAction('typing').catch(() => {});

        void (async () => {
            const t0 = Date.now();
            try {
                const output = await runAgentTurn({
                    userId,
                    sessionId,
                    message: cleanText,
                    onImage: async (data, mimeType, caption) => {
                        const buffer = Buffer.from(data, 'base64');
                        await ctx.replyWithPhoto({ source: buffer }, caption ? { caption } : undefined);
                    },
                });
                const elapsed = Date.now() - t0;
                log.info(MODULE, 'Turn completed', { chatId, sessionId, elapsed, responseLen: output.length });
                const text = output || '模型没有返回可显示内容。';
                // 按原文分段（避免切断 HTML 标签），再逐段转 HTML 发送
                for (const part of splitTelegramText(text)) {
                    const html = markdownToTelegramHtml(part);
                    try {
                        await ctx.reply(html, { parse_mode: 'HTML' });
                    } catch {
                        // HTML 解析失败时回退纯文本
                        await ctx.reply(part);
                    }
                }
            } catch (err: unknown) {
                const elapsed = Date.now() - t0;
                const msg = err instanceof Error ? err.message : String(err);
                log.error(MODULE, 'Turn failed', { chatId, sessionId, elapsed, error: msg, stack: err instanceof Error ? err.stack : undefined });
                await ctx.reply(`处理失败：${msg}`).catch(() => {});
            }
        })();
    });

    await bot.launch();
    log.info(MODULE, 'Bot started (long polling)');

    return {
        stop(): void {
            bot.stop('shutdown');
        },
    };
}