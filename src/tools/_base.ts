/**
 * _base.ts — Re-exports the Tool types for use in tool files.
 * Import from here inside each tool file to avoid deep relative paths.
 */
export type { Tool, ToolMeta, ToolContext } from '../utils/gemini-types.js';
