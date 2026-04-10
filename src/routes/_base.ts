import type Router from '@koa/router';
import type { LLMClient } from '../llm/client.js';

export interface RouteContext {
    llm: LLMClient;
}

/** Every route module must export a function with this exact signature. */
export type RouteRegistrar = (router: Router, ctx: RouteContext) => void;
