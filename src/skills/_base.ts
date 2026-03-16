/**
 * _base.ts — Re-exports the Skill types from gemini-client for use in skill files.
 * Import from here inside each skill file to avoid deep relative paths.
 */
export type { Skill, SkillMeta } from '../lib/gemini-client.js';
