/**
 * src/agent/profiles/builtins.ts — Built-in agent profiles.
 *
 * `default` is intentionally unconstrained so it reproduces current behaviour
 * exactly. The others are small, opt-in examples that demonstrate scoping.
 */

import type { AgentProfile } from './types.js';

/** Unconstrained profile — equals today's behaviour. */
export const DEFAULT_PROFILE: AgentProfile = {
    id: 'default',
    name: 'Default',
    description: 'Unconstrained default agent — preserves current behaviour.',
    memory: 'read-write',
};

/** Read-only research agent: reads/searches only, no persistence. */
export const RESEARCH_PROFILE: AgentProfile = {
    id: 'research',
    name: 'Research',
    description: 'Read-only researcher. Reads and searches but never mutates the workspace.',
    memory: 'read',
    personality: [
        'You are operating as a focused research agent.',
        'Prioritise gathering, citing, and synthesising information.',
        'Do not attempt to modify files or run side-effecting commands.',
    ].join('\n'),
    tools: { maxTier: 'read' },
};

/** Coding agent: full read/write but blocks dangerous shell side-effects. */
export const CODING_PROFILE: AgentProfile = {
    id: 'coding',
    name: 'Coding',
    description: 'Coding assistant with read/write tools but no dangerous shell access.',
    memory: 'read-write',
    personality: [
        'You are operating as a coding agent.',
        'Make focused, correct edits and verify your work.',
    ].join('\n'),
    tools: { maxTier: 'write' },
};

/** All shipped built-in profiles, keyed by id. */
export const BUILTIN_PROFILES: readonly AgentProfile[] = [
    DEFAULT_PROFILE,
    RESEARCH_PROFILE,
    CODING_PROFILE,
];

export const DEFAULT_PROFILE_ID = DEFAULT_PROFILE.id;
