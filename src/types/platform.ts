/**
 * types/platform.ts — Platform identity types.
 */

export type Platform = 'telegram' | 'feishu' | 'web';

export type TenantKey = `${Platform}:${string}`;

export type UserId = string;
