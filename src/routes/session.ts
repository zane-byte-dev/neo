import type Router from '@koa/router';
import { sessionCreate } from '../services/chat-service';

export function newSession(router: Router): void {
    router.post('/api/session/clear', async (ctx: import('koa').Context) => {
        const reqUserId: string | undefined = ctx.state.userId;
        if (reqUserId) {
            sessionCreate(reqUserId);
        }
        ctx.body = { ok: true };
    });
}


