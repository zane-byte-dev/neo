import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rememberTurn, rememberFact, recall } from '../manager.js';

describe('memory/manager', () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'neo-memory-'));
    });
    afterEach(async () => {
        await rm(workDir, { recursive: true, force: true });
    });

    it('persists turn episodes and recalls them', async () => {
        await rememberTurn(workDir, {
            sessionId: 's-1',
            userId: 'u',
            userMsg: '帮我看看 M4 上跑 LiteLLM 的方案',
            assistantMsg: '可以用 Docker 部署 LiteLLM proxy 做统一入口',
        });
        const hits = await recall(workDir, 'LiteLLM 方案', { topK: 5 });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].item.text).toContain('LiteLLM');
    });

    it('persists semantic facts and they rank higher than episodes', async () => {
        await rememberTurn(workDir, {
            sessionId: 's-1', userId: 'u',
            userMsg: '我喜欢深色主题', assistantMsg: '好的',
        });
        await rememberFact(workDir, {
            text: '用户偏好深色主题（dark mode）',
            category: 'preference',
            userId: 'u',
        });
        const hits = await recall(workDir, '深色主题', { topK: 5 });
        expect(hits[0].item.tier).toBe('semantic');
    });

    it('writes sharded episodes to memory/episodes/', async () => {
        await rememberTurn(workDir, {
            sessionId: 's-1', userId: 'u',
            userMsg: 'hello', assistantMsg: 'hi',
        });
        const shard = new Date().toISOString().slice(0, 7);
        const raw = await readFile(join(workDir, '.neo', 'memory', 'episodes', `${shard}.jsonl`), 'utf8');
        expect(raw).toContain('"tier":"episodic"');
        expect(raw).toContain('"role":"user"');
        expect(raw).toContain('"role":"assistant"');
    });
});
