import { promises as fs } from 'fs';
import { resolve } from 'path';
import { hasPending, resolve as resolveUserInput } from '../services/user-input-waiter.js';
import { isAuthorized, GEMINI_API_KEY } from '../config.js';
import { getTenantContext } from '../services/tool-context.js';
import type { TodoManager } from '../services/todo-manager.js';
import type { PlatformAdapter, NormalizedMessage, TenantKey } from '../types/platform.js';
import type { Task } from './types.js';

interface MessageRouterDeps {
    adapter: PlatformAdapter;
    asyncTriggerPrefixes: string[];
    pendingReadMatches: Map<string, { matches: string[]; expiry: number }>;
    todoManager: TodoManager;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
    handleAsyncTask: (msg: NormalizedMessage) => Promise<void>;
    handleCommand: (msg: NormalizedMessage) => Promise<void>;
    handleUrlMessage: (msg: NormalizedMessage, url: string) => Promise<void>;
}

export async function processMessage(deps: MessageRouterDeps, msg: NormalizedMessage) {
    const { tenantKey, chatId, userName, id: messageId } = msg;
    const rawText = msg.text;
    const quotedText = msg.quotedText ?? null;
    const text = quotedText
        ? `[引用消息]: ${quotedText}\n\n[我的问题]: ${rawText}`
        : rawText;

    const preview = rawText.length > 50 ? `${rawText.substring(0, 50)}...` : rawText;
    console.log(`[Message] From ${userName} (${tenantKey}, MsgID: ${messageId}${quotedText ? ', replying' : ''}): ${preview}`);

    if (!isAuthorized(tenantKey)) {
        await deps.adapter.sendMessage(chatId, '⛔ Unauthorized.');
        return;
    }

    // If ask_user tool is waiting for input, route this message directly to it
    if (hasPending(chatId)) {
        resolveUserInput(chatId, rawText);
        return;
    }

    if (rawText.startsWith('/')) {
        if (rawText.startsWith('/research') || rawText.startsWith('/async')) {
            await deps.handleAsyncTask(msg);
            return;
        }
        if (rawText.startsWith('/btw')) {
            await handleBtwMessage(deps, msg);
            return;
        }
        await deps.handleCommand(msg);
        return;
    }

    const quickPick = rawText.match(/^r(\d+)$/i);
    if (quickPick) {
        const pending = deps.pendingReadMatches.get(chatId);
        if (pending && pending.expiry > Date.now()) {
            const idx = parseInt(quickPick[1], 10) - 1;
            if (idx >= 0 && idx < pending.matches.length) {
                deps.pendingReadMatches.delete(chatId);
                const absPath = pending.matches[idx];
                const tenantCtx = getTenantContext(tenantKey);
                const resolvedBase = tenantCtx.workDir;
                const relPath = absPath.slice(resolvedBase.length + 1);
                try {
                    const stat = await fs.stat(absPath);
                    if (stat.size > 100 * 1024) {
                        await deps.adapter.sendMessage(chatId, `⚠️ 文件超过 100KB（${(stat.size / 1024).toFixed(1)}KB），请缩小范围。`);
                        return;
                    }
                    const content = await fs.readFile(absPath, 'utf8');
                    const MAX_MSG = 4000;
                    const header = `📄 ${relPath}\n\n`;
                    if (header.length + content.length <= MAX_MSG) {
                        await deps.adapter.sendMessage(chatId, header + content);
                    } else {
                        const chunks: string[] = [];
                        for (let i = 0; i < content.length; i += MAX_MSG - header.length) {
                            chunks.push(content.slice(i, i + MAX_MSG - header.length));
                        }
                        await deps.adapter.sendMessage(chatId, `📄 ${relPath} (${chunks.length} 段)\n\n${chunks[0]}`);
                        for (let i = 1; i < chunks.length; i++) {
                            await deps.adapter.sendMessage(chatId, chunks[i]).catch(() => {});
                        }
                    }
                } catch (err: any) {
                    await deps.adapter.sendMessage(chatId, `❌ 无法读取文件: ${err.message}`);
                }
                return;
            }
        }
    }

    if (deps.asyncTriggerPrefixes.some((prefix) => rawText.startsWith(prefix))) {
        await deps.handleAsyncTask(msg);
        return;
    }

    const urlMatch = rawText.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
        await deps.handleUrlMessage(msg, urlMatch[0]);
        return;
    }

    const task: Task = { tenantKey, chatId, question: text, userName, messageId };
    await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
}

async function handleBtwMessage(deps: MessageRouterDeps, msg: NormalizedMessage) {
    const question = msg.text.replace(/^\/btw\s*/i, '').trim();
    if (!question) {
        await deps.adapter.sendMessage(msg.chatId, '用法: `/btw <问题>`\n\n临时问答，不计入对话上下文。', { parseMode: 'markdown' });
        return;
    }
    const task: Task = { tenantKey: msg.tenantKey, chatId: msg.chatId, question, userName: msg.userName, messageId: msg.id, skipHistory: true };
    await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
}
