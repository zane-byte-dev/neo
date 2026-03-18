/**
 * Markdown to Telegram format converter
 */

/**
 * Convert Markdown to Telegram HTML format.
 * Telegram does not support full GitHub Markdown; this converts a practical subset.
 */
export function markdownToTelegram(text: string): string {
    const codeBlocks: string[] = [];

    const escapeHtml = (input: string): string =>
        input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    let converted = text.replace(/\r\n/g, '\n');

    // Use \x01 as delimiter: no underscores (safe from italic regex), no @ (safe from Telegram mention linkification)
    converted = converted.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code: string) => {
        const token = `\x01CB${codeBlocks.length}\x01`;
        codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
        return token;
    });

    // Protect inline code spans before any bold/italic processing so that
    // underscores inside `tool_names` don't get mangled by the _.._ italic regex.
    const inlineCodeSpans: string[] = [];
    converted = converted.replace(/`([^`]+)`/g, (_, code: string) => {
        const token = `\x01IC${inlineCodeSpans.length}\x01`;
        inlineCodeSpans.push(`<code>${escapeHtml(code)}</code>`);
        return token;
    });

    converted = escapeHtml(converted);

    // Links: [text](url)
    converted = converted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

    // Headings: # text
    converted = converted.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

    // Bold and italic
    converted = converted.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    converted = converted.replace(/__(.+?)__/g, '<b>$1</b>');
    converted = converted.replace(/\*(.+?)\*/g, '<i>$1</i>');
    converted = converted.replace(/_(.+?)_/g, '<i>$1</i>');

    // Restore inline code spans
    for (let i = 0; i < inlineCodeSpans.length; i++) {
        converted = converted.replace(`\x01IC${i}\x01`, inlineCodeSpans[i]);
    }

    // Bullets
    converted = converted.replace(/^\s*[-*+]\s+/gm, '• ');

    // Horizontal rules
    converted = converted.replace(/^---+$/gm, '');
    converted = converted.replace(/^___+$/gm, '');
    converted = converted.replace(/^\*\*\*+$/gm, '');

    // Restore fenced code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
        converted = converted.replace(`\x01CB${i}\x01`, codeBlocks[i]);
    }

    return converted.replace(/\n{3,}/g, '\n\n').trim();
}
