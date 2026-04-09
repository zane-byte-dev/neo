import { join } from 'path';
import { promises as fs } from 'fs';
import { execa } from 'execa';
import { getTenantContext } from '../services/tool-context.js';
import { geminiUploadFile } from '../services/gemini-client.js';
import {
    MAX_FILE_SIZE_BYTES,
    TEXT_MIME_PREFIXES,
    TEXT_EXTENSIONS,
    SPREADSHEET_EXTENSIONS,
    GEMINI_NATIVE_MIMES,
    isAuthorized,
    GEMINI_API_KEY,
} from '../config.js';
import type { PlatformAdapter, NormalizedMessage } from '../types/platform.js';
import type { Task } from '../core/types.js';

interface MediaDeps {
    adapter: PlatformAdapter;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function processDocumentMessage(deps: MediaDeps, msg: NormalizedMessage) {
    const { tenantKey, chatId, id: messageId, userName, media } = msg;
    const caption = media?.caption || '';

    if (!isAuthorized(tenantKey)) {
        await deps.adapter.sendMessage(chatId, '⛔ Unauthorized.');
        return;
    }

    const fileName = media?.fileName || 'document';
    const mimeType = media?.mimeType || 'application/octet-stream';
    const fileSizeBytes = media?.fileSize || 0;
    const fileId = media?.fileId;

    console.log(`[Document] From ${userName}: ${fileName} (${mimeType}, ${fileSizeBytes} bytes)`);

    if (!fileId) {
        await deps.adapter.sendMessage(chatId, '⚠️ 无法获取文件。');
        return;
    }

    if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
        await deps.adapter.sendMessage(chatId, '⚠️ 文件超过 20MB，暂不支持。');
        return;
    }

    const statusMsg = await deps.adapter.sendMessage(chatId, `📄 正在处理文件: ${fileName}...`, { replyToId: messageId });

    const tmpDir = join(getTenantContext(tenantKey).workDir, '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `doc_${messageId}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

    try {
        await deps.adapter.downloadFile(fileId, tmpPath);
    } catch (err: any) {
        console.error(`[Document Error] Download failed: ${err.message}`);
        await deps.adapter.editMessage(chatId, statusMsg.id, `⚠️ 文件下载失败: ${err.message}`).catch(() => {});
        return;
    }

    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';

    const isPlainText = TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) || TEXT_EXTENSIONS.has(ext);
    const isSpreadsheet = SPREADSHEET_EXTENSIONS.has(ext);
    const isGeminiNative = GEMINI_NATIVE_MIMES.has(mimeType);

    let question: string;
    let fileUri: string | undefined;
    let fileMimeType: string | undefined;

    try {
        if (isPlainText) {
            const content = await fs.readFile(tmpPath, 'utf8');
            const truncated = content.length > 30000
                ? content.slice(0, 30000) + '\n\n[...内容过长，已截断至前 30000 字符]'
                : content;
            question = caption
                ? `${caption}\n\n[文件名: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``
                : `请分析以下文件内容并给出总结或见解。\n\n[文件名: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``;

        } else if (isSpreadsheet) {
            await deps.adapter.editMessage(chatId, statusMsg.id, '📊 正在转换表格内容...').catch(() => {});
            const csvText = await convertSpreadsheetToText(tmpPath, ext);
            if (!csvText) {
                await deps.adapter.editMessage(chatId, statusMsg.id,
                    `⚠️ 无法解析 **${ext}** 格式。\n\n` +
                    `**解决方法：**\n` +
                    `• 在 Numbers / Excel 中选「文件 → 导出 → CSV」\n` +
                    `• 重新上传 **.csv** 文件\n\n` +
                    '如已安装 LibreOffice，请确保 `soffice` 命令可用。',
                    { parseMode: 'markdown' },
                ).catch(() => {});
                await fs.unlink(tmpPath).catch(() => {});
                return;
            }
            const truncated = csvText.length > 30000
                ? csvText.slice(0, 30000) + '\n\n[...内容过长，已截断]'
                : csvText;
            question = caption
                ? `${caption}\n\n[表格文件: ${fileName}]\n\`\`\`csv\n${truncated}\n\`\`\``
                : `请分析下表格数据并给出总结。\n\n[表格文件: ${fileName}]\n\`\`\`csv\n${truncated}\n\`\`\``;

        } else if (isGeminiNative) {
            await deps.adapter.editMessage(chatId, statusMsg.id, '📄 正在上传文件...').catch(() => {});
            fileUri = await uploadToGeminiFileApi(tmpPath, mimeType);
            fileMimeType = mimeType;
            question = caption || `请分析这份文件并给出详细总结。[文件名: ${fileName}]`;
            await deps.adapter.editMessage(chatId, statusMsg.id, '📄 文件已上传，正在分析...').catch(() => {});

        } else {
            const supported = 'PDF · 图片(JPG/PNG/WebP/HEIC) · 音频(MP3/WAV/OGG) · 视频(MP4/MOV)\n文本/代码(TXT/MD/CSV/JSON/...) · 表格(Numbers/Excel → 导出为 CSV)';
            await deps.adapter.editMessage(chatId, statusMsg.id,
                `⚠️ 暂不支持 **${ext || mimeType}** 格式。\n\n**支持的格式:**\n${supported}`,
                { parseMode: 'markdown' },
            ).catch(() => {});
            await fs.unlink(tmpPath).catch(() => {});
            return;
        }
    } catch (err: any) {
        console.error(`[Document Error] Processing failed: ${err.message}`);
        await deps.adapter.editMessage(chatId, statusMsg.id, `⚠️ 文件处理失败: ${err.message}`).catch(() => {});
        await fs.unlink(tmpPath).catch(() => {});
        return;
    }

    const task: Task = { tenantKey, chatId, question, userName, messageId, fileUri, fileMimeType };
    await deps.messageQueue.enqueue(task, async (t: Task) => {
        try {
            await deps.processTask(t);
        } finally {
            await deps.adapter.deleteMessage(chatId, statusMsg.id).catch(() => {});
            await fs.unlink(tmpPath).catch(() => {});
        }
    });
}

async function convertSpreadsheetToText(filePath: string, ext: string): Promise<string | null> {
    const outDir = join(filePath, '..');

    try {
        await execa('soffice', ['--headless', '--convert-to', 'csv', '--outdir', outDir, filePath], { timeout: 30000 });
        const csvPath = filePath.replace(/\.[^.]+$/, '.csv');
        const csv = await fs.readFile(csvPath, 'utf8');
        await fs.unlink(csvPath).catch(() => {});
        console.log(`[Document] Converted ${ext} → CSV via soffice (${csv.length} chars)`);
        return csv;
    } catch {
        console.log(`[Document] soffice not available or failed for ${ext}`);
    }

    if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
        try {
            const script = [
                'import openpyxl, sys',
                `wb = openpyxl.load_workbook(r\'${filePath}\', read_only=True, data_only=True)`,
                'out = []',
                'for name in wb.sheetnames:',
                '    ws = wb[name]',
                '    out.append(f"## Sheet: {name}")',
                '    for row in ws.iter_rows(values_only=True):',
                '        out.append(",".join("" if v is None else str(v).replace(",",";") for v in row))',
                'print("\\n".join(out))',
            ].join('\n');
            const { stdout } = await execa('python3', ['-c', script], { timeout: 30000 });
            if (stdout.trim()) {
                console.log(`[Document] Converted ${ext} → CSV via python3+openpyxl`);
                return stdout;
            }
        } catch {
            console.log('[Document] python3+openpyxl not available or failed');
        }
    }

    if (ext === '.numbers') {
        try {
            const script = [
                'import zipfile, sys',
                `zf = zipfile.ZipFile(r\'${filePath}\')`,
                'names = [n for n in zf.namelist() if n.lower().endswith(".csv")]',
                'if not names: sys.exit(1)',
                'print("\\n\\n".join(zf.read(n).decode("utf-8", errors="replace") for n in names[:5]))',
            ].join('\n');
            const { stdout } = await execa('python3', ['-c', script], { timeout: 15000 });
            if (stdout.trim()) {
                console.log('[Document] Extracted CSV sheets from .numbers zip');
                return stdout;
            }
        } catch {
            console.log('[Document] .numbers zip extraction found no embedded CSV');
        }
    }

    return null;
}

async function uploadToGeminiFileApi(filePath: string, mimeType: string): Promise<string> {
    const apiKey = GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

    const fileBuffer = await fs.readFile(filePath);
    return geminiUploadFile(apiKey, fileBuffer, mimeType);
}
