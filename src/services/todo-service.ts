/**
 * todo-service.ts — Registry and CRUD facade for TodoManager instances.
 *
 * Manages one TodoManager per scope key so callers never construct managers
 * directly or hold their own singletons.
 *
 * Usage:
 *   - app.ts: const tm = initTodoScope(userId); tm.init(onFire, onCron);
 *   - web routes: todoList('web'), todoAdd('web', input), …
 */
import { TodoManager } from './todo-manager.js';
import type { TodoCreateInput, TodoPatchInput } from './todo-manager.js';

const _registry = new Map<string, TodoManager>();

/**
 * Create and register a TodoManager for a scope.
 * Returns the manager so the caller (app.ts) can call .init() with callbacks.
 * If already registered, returns the existing instance.
 */
export function initTodoScope(scopeKey: string): TodoManager {
    if (!_registry.has(scopeKey)) {
        _registry.set(scopeKey, new TodoManager(scopeKey));
    }
    return _registry.get(scopeKey)!;
}

/**
 * Get the registered manager for a scope.
 * Lazily creates a plain (no-timer) manager if the scope was never explicitly
 * initialised — this covers the 'web' scope which only needs CRUD.
 */
function getManager(scopeKey: string): TodoManager {
    if (!_registry.has(scopeKey)) {
        _registry.set(scopeKey, new TodoManager(scopeKey));
    }
    return _registry.get(scopeKey)!;
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────

export function todoList(scopeKey: string) {
    return getManager(scopeKey).getTodos();
}

export function todoAdd(scopeKey: string, input: TodoCreateInput) {
    return getManager(scopeKey).add(input);
}

export function todoPatch(scopeKey: string, id: string, patch: TodoPatchInput): boolean {
    return getManager(scopeKey).patch(id, patch);
}

export function todoDelete(scopeKey: string, id: string): boolean {
    return getManager(scopeKey).delete(id);
}
