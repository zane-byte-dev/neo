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

    converted = converted.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code: string) => {
        const token = `@@CODE_BLOCK_${codeBlocks.length}@@`;
        codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
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

    // Inline code
    converted = converted.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bullets
    converted = converted.replace(/^\s*[-*+]\s+/gm, '• ');

    // Horizontal rules
    converted = converted.replace(/^---+$/gm, '');
    converted = converted.replace(/^___+$/gm, '');
    converted = converted.replace(/^\*\*\*+$/gm, '');

    // Restore fenced code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
        converted = converted.replace(`@@CODE_BLOCK_${i}@@`, codeBlocks[i]);
    }

    return converted.replace(/\n{3,}/g, '\n\n').trim();
}
