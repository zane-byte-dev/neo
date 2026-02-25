import { clipUrl } from './tools/clipper.js';
import { audioRefinery } from './tools/audio-refinery.js';
import { ebookRefinery } from './tools/ebook-refinery.js';
import { runMaintenance } from './tools/butler.js';

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

function wrap(fn: () => Promise<string>): Promise<ToolResult> {
    return fn()
        .then(output => ({ success: true, output }))
        .catch(err => ({ success: false, output: '', error: err instanceof Error ? err.message : String(err) }));
}

/** /clip <url> [target_dir] */
export function runClipper(url: string, targetDir?: string): Promise<ToolResult> {
    return wrap(() => clipUrl(url, targetDir).then(path => `Saved to: ${path}`));
}

/** /audioify <file_or_dir> [voice] */
export function runAudioRefinery(target: string, voice?: string): Promise<ToolResult> {
    return wrap(() => audioRefinery(target, voice));
}

/** /epub <file.epub> [output_dir] */
export function runEbookRefinery(epubPath: string, outputDir?: string): Promise<ToolResult> {
    return wrap(() => ebookRefinery(epubPath, outputDir));
}

/** /butler (No args needed) */
export function runButler(): Promise<ToolResult> {
    return wrap(() => runMaintenance());
}
