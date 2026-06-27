import Koa from 'koa';

export const SESSION_COOKIE = 'neo_uid';
export const COOKIE_OPTS: Parameters<Koa.Context['cookies']['set']>[2] = {
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    overwrite: true,
};