import type Router from '@koa/router';
import { todoList, todoAdd, todoPatch, todoDelete } from '../services/todo-service.js';
import { geminiGenerate } from '../llm/providers/gemini/index.js';
import { GEMINI_API_KEY, MAX_INPUT_LENGTH } from '../config.js';

export function todoAnalyze(router: Router): void {
    router.post('/api/todos/analyze', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }

        const now = new Date();
        const prompt = `Current datetime: ${now.toISOString()} (${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} CST)

Analyze this todo item and return a JSON object:
"${content}"

Return ONLY valid JSON with these fields:
- content: slightly cleaned/clarified todo text (keep short, in the original language)
- remind_at: ISO 8601 datetime string if the text implies a time (e.g. "明天" next day 09:00, "下午3点" today 15:00, "下周一" next Monday 09:00), otherwise null
- priority: "high" / "medium" / "low" based on urgency keywords, or null

Example: {"content":"预约牙医","remind_at":"2026-04-09T09:00:00+08:00","priority":"medium"}`;

        const result = await geminiGenerate(
            GEMINI_API_KEY,
            [{ role: 'user', parts: [{ text: prompt }] }],
            { model: 'flash', generationConfig: { responseMimeType: 'application/json' } }
        );

        if (!result) { ctx.body = { content, remind_at: null, priority: null }; return; }
        try {
            const parsed = JSON.parse(result);
            ctx.body = {
                content: typeof parsed.content === 'string' ? parsed.content : content,
                remind_at: typeof parsed.remind_at === 'string' ? parsed.remind_at : null,
                priority: typeof parsed.priority === 'string' ? parsed.priority : null,
            };
        } catch {
            ctx.body = { content, remind_at: null, priority: null };
        }
    });
}

export function todoGetAll(router: Router): void {
    router.get('/api/todos', (ctx) => {
        const todos = todoList('web');
        ctx.body = todos.map(t => ({
            id: t.id,
            content: t.content,
            status: t.status === 'done' ? 'completed' : t.status === 'pending' ? 'not-started' : t.status,
            priority: t.priority,
            remind_at: t.fireAt ? new Date(t.fireAt).toISOString() : null,
            created_at: new Date(t.createdAt).toISOString(),
            updated_at: new Date(t.updatedAt).toISOString(),
        }));
    });
}

export function todoCreate(router: Router): void {
    router.post('/api/todos', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        if (content.length > MAX_INPUT_LENGTH) { ctx.status = 400; ctx.body = { error: `content too long (max ${MAX_INPUT_LENGTH} chars)` }; return; }
        const priority = typeof body.priority === 'string' && body.priority.trim() ? body.priority.trim() : null;
        const remindAt = typeof body.remind_at === 'string' && body.remind_at.trim() ? body.remind_at.trim() : null;
        const fireAt = remindAt ? new Date(remindAt).getTime() : null;

        const todo = todoAdd('web', { content, status: 'pending', priority, fireAt });
        ctx.body = {
            id: todo.id,
            content: todo.content,
            status: 'not-started',
            priority: todo.priority,
            remind_at: todo.fireAt ? new Date(todo.fireAt).toISOString() : null,
            created_at: new Date(todo.createdAt).toISOString(),
            updated_at: new Date(todo.updatedAt).toISOString(),
        };
    });
}

export function todoPatch_(router: Router): void {
    router.patch('/api/todos/:id', async (ctx) => {
        const todoId = ctx.params.id;
        const body = ctx.request.body as Record<string, unknown>;
        const patch: Record<string, unknown> = {};

        if (body.status !== undefined) {
            const status = body.status as string;
            const validStatuses = ['not-started', 'completed'];
            if (!validStatuses.includes(status)) { ctx.status = 400; ctx.body = { error: 'invalid status' }; return; }
            patch.status = status === 'completed' ? 'done' : 'pending';
        }
        if (body.content !== undefined) {
            const content = typeof body.content === 'string' ? body.content.trim() : '';
            if (!content) { ctx.status = 400; ctx.body = { error: 'content cannot be empty' }; return; }
            patch.content = content;
        }
        if (body.remind_at !== undefined) {
            if (body.remind_at === null) {
                patch.fireAt = null;
            } else {
                const remindAt = typeof body.remind_at === 'string' ? body.remind_at.trim() || null : null;
                patch.fireAt = remindAt ? new Date(remindAt).getTime() : null;
            }
        }
        if (body.priority !== undefined) {
            patch.priority = body.priority === null ? null : (typeof body.priority === 'string' ? body.priority.trim() || null : null);
        }

        const ok = todoPatch('web', todoId, patch);
        if (!ok) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

export function todoRemove(router: Router): void {
    router.delete('/api/todos/:id', (ctx) => {
        todoDelete('web', ctx.params.id);
        ctx.body = { ok: true };
    });
}


