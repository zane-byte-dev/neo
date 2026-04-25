/**
 * chat-service.test.ts — Tests for file-based chat session and message persistence.
 *
 * Challenge: chat-service.ts hardcodes _spaceDir via import.meta.url.
 * We work around this by using vi.mock to redirect the path helpers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// We need to mock the path calculation in chat-service.
// The module uses _spaceDir resolved from import.meta.url.
// We'll use vi.hoisted + vi.mock to override it.

let testSpaceDir: string;
const TEST_USER = 'testuser123';
const ORIGINAL_USERS_ENV = process.env.USERS;

// Create a unique temp space dir before mocking
const tmpBase = join(tmpdir(), `neo-test-chat-${randomBytes(6).toString('hex')}`);

vi.mock('node:url', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:url')>();
    return {
        ...original,
        fileURLToPath: (url: string) => {
            // When chat-service.ts calls fileURLToPath(import.meta.url),
            // we redirect so _projectRoot resolves to our tmp dir.
            // _projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
            // So dirname(result) should be <tmpBase>/src/services => result = <tmpBase>/src/services/chat-service.ts
            if (url.includes('chat-service')) {
                return join(tmpBase, 'src', 'services', 'chat-service.ts');
            }
            return original.fileURLToPath(url);
        },
    };
});

// Dynamically import after mock is set up
let sessionCreate: typeof import('../chat-service.js').sessionCreate;
let sessionGet: typeof import('../chat-service.js').sessionGet;
let sessionGetCurrent: typeof import('../chat-service.js').sessionGetCurrent;
let sessionList: typeof import('../chat-service.js').sessionList;
let sessionPatch: typeof import('../chat-service.js').sessionPatch;
let sessionDelete: typeof import('../chat-service.js').sessionDelete;
let messageAdd: typeof import('../chat-service.js').messageAdd;
let messageList: typeof import('../chat-service.js').messageList;

beforeEach(async () => {
    testSpaceDir = join(tmpBase, 'space');
    await fs.mkdir(join(testSpaceDir, TEST_USER, '.tmp'), { recursive: true });
    process.env.USERS = JSON.stringify([
        {
            id: TEST_USER,
            name: 'Test User',
            workspace: 'test',
            workspaceDir: testSpaceDir,
        },
    ]);

    // Dynamic import to pick up mocked node:url
    const mod = await import('../chat-service.js');
    sessionCreate = mod.sessionCreate;
    sessionGet = mod.sessionGet;
    sessionGetCurrent = mod.sessionGetCurrent;
    sessionList = mod.sessionList;
    sessionPatch = mod.sessionPatch;
    sessionDelete = mod.sessionDelete;
    messageAdd = mod.messageAdd;
    messageList = mod.messageList;
});

afterEach(async () => {
    if (ORIGINAL_USERS_ENV === undefined) delete process.env.USERS;
    else process.env.USERS = ORIGINAL_USERS_ENV;
    await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
});

describe('Session operations', () => {
    it('sessionCreate creates a session with is_current = 1', async () => {
        const session = await sessionCreate(TEST_USER);
        expect(session.id).toBeTruthy();
        expect(session.user_id).toBe(TEST_USER);
        expect(session.is_current).toBe(1);
        expect(session.is_pinned).toBe(0);
        expect(session.title).toBe('');
    });

    it('sessionCreate with explicit id uses that id', async () => {
        const session = await sessionCreate(TEST_USER, 'my-id');
        expect(session.id).toBe('my-id');
    });

    it('creating new session deactivates previous current session', async () => {
        const s1 = await sessionCreate(TEST_USER, 'session-1');
        expect(s1.is_current).toBe(1);

        const s2 = await sessionCreate(TEST_USER, 'session-2');
        expect(s2.is_current).toBe(1);

        // s1 should now be is_current = 0
        const s1After = await sessionGet('session-1', TEST_USER);
        expect(s1After).not.toBeNull();
        expect(s1After!.is_current).toBe(0);
    });

    it('sessionGet retrieves an existing session', async () => {
        await sessionCreate(TEST_USER, 'get-test');
        const session = await sessionGet('get-test', TEST_USER);
        expect(session).not.toBeNull();
        expect(session!.id).toBe('get-test');
    });

    it('sessionGet returns null for non-existent session', async () => {
        const session = await sessionGet('nonexistent', TEST_USER);
        expect(session).toBeNull();
    });

    it('sessionGetCurrent returns the current session', async () => {
        await sessionCreate(TEST_USER, 'old');
        await sessionCreate(TEST_USER, 'latest');

        const current = await sessionGetCurrent(TEST_USER);
        expect(current).not.toBeNull();
        expect(current!.id).toBe('latest');
        expect(current!.is_current).toBe(1);
    });

    it('sessionGetCurrent returns null when no sessions exist', async () => {
        const current = await sessionGetCurrent(TEST_USER);
        expect(current).toBeNull();
    });

    it('sessionList returns sessions sorted by start_time desc', async () => {
        await sessionCreate(TEST_USER, 'a');
        // Small delay to ensure different timestamps
        await new Promise(r => setTimeout(r, 10));
        await sessionCreate(TEST_USER, 'b');

        const list = await sessionList(TEST_USER);
        expect(list.length).toBe(2);
        // Most recent first
        expect(list[0].id).toBe('b');
        expect(list[1].id).toBe('a');
    });

    it('sessionList respects limit', async () => {
        for (let i = 0; i < 5; i++) {
            await sessionCreate(TEST_USER, `s-${i}`);
        }
        const list = await sessionList(TEST_USER, 3);
        expect(list.length).toBe(3);
    });

    it('sessionPatch updates title', async () => {
        await sessionCreate(TEST_USER, 'patch-test');
        const patched = await sessionPatch('patch-test', TEST_USER, { title: 'New Title' });
        expect(patched).not.toBeNull();
        expect(patched!.title).toBe('New Title');
    });

    it('sessionPatch updates is_pinned', async () => {
        await sessionCreate(TEST_USER, 'pin-test');
        const patched = await sessionPatch('pin-test', TEST_USER, { is_pinned: 1 });
        expect(patched).not.toBeNull();
        expect(patched!.is_pinned).toBe(1);
    });

    it('sessionPatch returns null for non-existent session', async () => {
        const result = await sessionPatch('nonexistent', TEST_USER, { title: 'x' });
        expect(result).toBeNull();
    });

    it('sessionDelete removes a session', async () => {
        await sessionCreate(TEST_USER, 'del-test');
        const result = await sessionDelete('del-test', TEST_USER);
        expect(result).toBe(true);

        const check = await sessionGet('del-test', TEST_USER);
        expect(check).toBeNull();
    });

    it('sessionDelete returns false for non-existent session', async () => {
        expect(await sessionDelete('nonexistent', TEST_USER)).toBe(false);
    });
});

describe('Message operations', () => {
    it('messageAdd appends a message', async () => {
        await sessionCreate(TEST_USER, 'msg-test');
        const msg = await messageAdd('msg-test', TEST_USER, 'user', 'Hello!');
        expect(msg.id).toBe(1);
        expect(msg.role).toBe('user');
        expect(msg.content).toBe('Hello!');
        expect(msg.session_id).toBe('msg-test');
        expect(msg.user_id).toBe(TEST_USER);
    });

    it('messageAdd auto-titles session from first user message', async () => {
        await sessionCreate(TEST_USER, 'title-test');
        await messageAdd('title-test', TEST_USER, 'user', 'What is the weather today?');

        const session = await sessionGet('title-test', TEST_USER);
        expect(session!.title).toBe('The weather today');
    });

    it('messageAdd derives a concise Chinese title from a request-style first message', async () => {
        await sessionCreate(TEST_USER, 'title-cn-test');
        await messageAdd('title-cn-test', TEST_USER, 'user', '帮我优化一下对话标题的生成逻辑，需要根据第一个对话内容总结获得标题。');

        const session = await sessionGet('title-cn-test', TEST_USER);
        expect(session!.title).toBe('优化对话标题的生成逻辑');
    });

    it('messageAdd updates session end_time', async () => {
        await sessionCreate(TEST_USER, 'time-test');
        const before = (await sessionGet('time-test', TEST_USER))!.end_time;

        await new Promise(r => setTimeout(r, 10));
        await messageAdd('time-test', TEST_USER, 'user', 'Update time');

        const after = (await sessionGet('time-test', TEST_USER))!.end_time;
        expect(after).not.toBe(before);
    });

    it('messageList returns messages in order', async () => {
        await sessionCreate(TEST_USER, 'list-test');
        await messageAdd('list-test', TEST_USER, 'user', 'First');
        await messageAdd('list-test', TEST_USER, 'assistant', 'Second');
        await messageAdd('list-test', TEST_USER, 'user', 'Third');

        const msgs = await messageList('list-test', TEST_USER);
        expect(msgs).toHaveLength(3);
        expect(msgs[0].content).toBe('First');
        expect(msgs[1].content).toBe('Second');
        expect(msgs[2].content).toBe('Third');
    });

    it('messageList respects limit (returns most recent N)', async () => {
        await sessionCreate(TEST_USER, 'limit-test');
        for (let i = 0; i < 5; i++) {
            await messageAdd('limit-test', TEST_USER, 'user', `Msg ${i}`);
        }
        const msgs = await messageList('limit-test', TEST_USER, 3);
        expect(msgs).toHaveLength(3);
        expect(msgs[0].content).toBe('Msg 2');
        expect(msgs[2].content).toBe('Msg 4');
    });

    it('messageList returns empty array for empty session', async () => {
        await sessionCreate(TEST_USER, 'empty');
        const msgs = await messageList('empty', TEST_USER);
        expect(msgs).toEqual([]);
    });

    it('messageAdd with userName sets user_name field', async () => {
        await sessionCreate(TEST_USER, 'name-test');
        const msg = await messageAdd('name-test', TEST_USER, 'user', 'Hi', 'Neo');
        expect(msg.user_name).toBe('Neo');
    });

    it('messageAdd without userName sets user_name to null', async () => {
        await sessionCreate(TEST_USER, 'null-name');
        const msg = await messageAdd('null-name', TEST_USER, 'user', 'Hi');
        expect(msg.user_name).toBeNull();
    });
});
