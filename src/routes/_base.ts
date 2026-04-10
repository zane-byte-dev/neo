import type { LLMClient } from '../llm/client.js';

export interface RouteContext {
    llm: LLMClient;
}
