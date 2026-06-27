/**
 * src/utils/telegram-html.ts — Convert Markdown to Telegram-compatible HTML.
 *
 * Extracted from platforms/telegram-bot.ts for testability and reuse.
 */

const TELEGRAM_MAX_MESSAGE = 3800;

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

/**
 * Convert common Markdown (as produced by LLMs) to Telegram-compatible HTML.
 * Handles: code blocks, inline code, bold, italic, strikethrough, links,
 * blockquotes, and headings. Unrecognized markup passes through escaped.
 */
export function markdownToTelegramHtml(md: string): string {
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

export function splitTelegramText(text: string): string[] {
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
