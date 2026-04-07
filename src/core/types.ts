import type { TenantKey } from '../types/platform.js';

export interface Task {
    /** Tenant key: platform:userId */
    tenantKey: TenantKey;
    /** Platform-specific chat ID (string for cross-platform compat) */
    chatId: string;
    question: string;
    userName: string;
    messageId: string;
    imagePath?: string;
    imageMimeType?: string;
    fileUri?: string;
    fileMimeType?: string;
    skipHistory?: boolean;
}
