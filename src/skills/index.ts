/**
 * src/skills/index.ts — Public API for the skills subsystem.
 *
 * Usage:
 *   import { loadUserSkills, SkillRegistry } from '../skills/index.js';
 */

export { parseSkillFile } from './skill-parser.js';
export type { SkillDefinition, SkillFrontmatter } from './skill-parser.js';

export { SkillRegistry, loadUserSkills } from './skill-registry.js';

export { executeSkill, interpolate } from './skill-executor.js';
