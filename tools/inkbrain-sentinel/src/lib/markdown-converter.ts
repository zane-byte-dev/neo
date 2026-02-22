/**
 * Markdown to Telegram format converter
 */

/**
 * Convert Markdown to Telegram-friendly format
 * Removes unsupported Markdown and cleans up formatting
 */
export function markdownToTelegram(text: string): string {
    let converted = text;

    // Remove code blocks (```), keep the content
    converted = converted.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
        return `\n${code.trim()}\n`;
    });

    // Remove inline code backticks, keep content
    converted = converted.replace(/`([^`]+)`/g, '$1');

    // Convert bold **text** or __text__ to *text* (Telegram bold)
    converted = converted.replace(/\*\*(.+?)\*\*/g, '*$1*');
    converted = converted.replace(/__(.+?)__/g, '*$1*');

    // Remove italic markers (Telegram doesn't support _ for italic reliably)
    converted = converted.replace(/_(.+?)_/g, '$1');

    // Remove headers (#, ##, ###) - just keep the text
    converted = converted.replace(/^#{1,6}\s+(.+)$/gm, '$1');

    // Convert bullet points - → to •
    converted = converted.replace(/^[-*+]\s/gm, '• ');

    // Remove horizontal rules
    converted = converted.replace(/^---+$/gm, '');
    converted = converted.replace(/^___+$/gm, '');
    converted = converted.replace(/^\*\*\*+$/gm, '');

    // Remove link markdown [text](url), keep text
    converted = converted.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Clean up excessive newlines (more than 2)
    converted = converted.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace
    converted = converted.trim();

    return converted;
}
