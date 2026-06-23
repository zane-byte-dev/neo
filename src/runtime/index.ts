/**
 * Compatibility shim for older app imports.
 *
 * New production code should import runtime APIs from `@neo/runtime`.
 * Runtime internals under `src/runtime/*` remain temporarily for focused unit
 * tests until those tests move alongside the workspace package.
 */

export * from '@neo/runtime';
