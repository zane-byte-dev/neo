/**
 * src/agent/profiles/types.ts — Declarative agent profile model.
 *
 * An `AgentProfile` bundles capability + behaviour so a single Neo instance
 * can present differently-scoped agents per entrypoint/task without forking
 * config or code:
 *
 *   - tools      : allow/deny lists + permission-tier cap.
 *   - model      : optional model alias/id override for routing.
 *   - personality: optional system-prompt block injected into the turn.
 *   - memory     : retrieval/persistence policy.
 *
 * The built-in `default` profile is unconstrained and reproduces today's
 * behaviour exactly.
 */

import type { RunEntrypoint } from '../../runtime/types.js';
import type { ToolPermission } from '../../llm/types.js';

/** Memory policy for a profile. */
export type ProfileMemoryMode = 'off' | 'read' | 'read-write';

/** Tool exposure policy. */
export interface ProfileToolPolicy {
    /**
     * Explicit allowlist. When non-empty, only these tool names are exposed
     * (still subject to `deny` and `maxTier`). When empty/omitted, all tools
     * are allowed unless denied.
     */
    allow?: string[];
    /** Tool names that are always hidden, regardless of `allow`. */
    deny?: string[];
    /** Highest permission tier a tool may have to be exposed. */
    maxTier?: ToolPermission;
}

/** Raw, author-facing profile shape (as parsed from config or built-ins). */
export interface AgentProfile {
    /** Stable identifier, e.g. `default`, `research`, `coding`. */
    id: string;
    /** Human-readable label. */
    name?: string;
    /** Short description of intended use. */
    description?: string;
    /** Model alias/id override (applied only when the caller didn't pick one). */
    model?: string;
    /** Personality / behaviour block appended to the system instruction. */
    personality?: string;
    /** Memory policy (default `read-write`). */
    memory?: ProfileMemoryMode;
    /** Tool exposure policy (default: unconstrained). */
    tools?: ProfileToolPolicy;
}

/**
 * Effective profile with defaults resolved. This is what the runner enforces.
 */
export interface ResolvedProfile {
    id: string;
    name: string;
    description: string;
    model?: string;
    personality?: string;
    memory: ProfileMemoryMode;
    tools: Required<Pick<ProfileToolPolicy, 'allow' | 'deny'>> & Pick<ProfileToolPolicy, 'maxTier'>;
}

/** Optional config: bind each entrypoint to a profile id. */
export type EntrypointProfileBindings = Partial<Record<RunEntrypoint, string>>;
