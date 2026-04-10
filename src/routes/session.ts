import type Router from '@koa/router';
import { ChatSession } from '../services/chat-service.js';
import type { RouteContext } from './_base.js';

export function newSession(router: Router): void {
    const handler = async (ctx: import('koa').Context) => {
        const reqUserId: string | undefined = ctx.state.userId;
        if (reqUserId) {
            new ChatSession(reqUserId).createNewSession();
        }
        ctx.body = { ok: true };
    };

    router.post('/api/session/new', handler);
    router.post('/api/session/clear', handler);
}

export function register(router: Router, _ctx: RouteContext): void {
    newSession(router);
}
