/**
 * sse.ts — Shared SSE response helpers for Koa routes.
 *
 * Provides a standard way to set up SSE responses with heartbeat,
 * abort signal, and safe event writing.
 *
 * Usage:
 *   const sse = createSSEResponse(ctx);
 *   try {
 *       await doWork(sse.send, sse.signal);
 *       sse.send({ type: 'done' });
 *   } catch (err) {
 *       sse.send({ type: 'error', text: err.message });
 *   } finally {
 *       sse.close();
 *   }
 */
import type { Context } from 'koa';
import type { ServerResponse } from 'node:http';

export interface SSEConnection {
    /** Send a JSON event to the client. No-op if connection is already closed. */
    send: (data: unknown) => void;
    /** AbortSignal that fires when the client disconnects. */
    signal: AbortSignal;
    /** Clear heartbeat and end the response. Safe to call multiple times. */
    close: () => void;
    /** The raw Node.js ServerResponse, for advanced use. */
    res: ServerResponse;
}

export interface SSEOptions {
    /** Heartbeat interval in ms. Default 15000. Set 0 to disable. */
    heartbeatMs?: number;
}

/**
 * Set up an SSE response on a Koa context.
 *
 * Bypasses Koa's response handling, writes SSE headers, starts a heartbeat,
 * and returns a connection object with `send()`, `signal`, and `close()`.
 */
export function createSSEResponse(ctx: Context, opts?: SSEOptions): SSEConnection {
    const res: ServerResponse = ctx.res;
    ctx.respond = false;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    // Heartbeat keep-alive to prevent proxies/browsers from dropping idle connections.
    const ms = opts?.heartbeatMs ?? 15_000;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (ms > 0) {
        heartbeat = setInterval(() => {
            if (res.destroyed || res.writableEnded) {
                clearInterval(heartbeat);
                return;
            }
            try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
        }, ms);
    }

    const send = (data: unknown) => {
        if (res.destroyed || res.writableEnded) return;
        try {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch { /* connection already gone */ }
    };

    const close = () => {
        if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
        if (!res.writableEnded) res.end();
    };

    return { send, signal: controller.signal, close, res };
}
