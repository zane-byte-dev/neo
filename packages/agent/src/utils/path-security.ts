import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface PathBoundaryOptions {
    allowEqual?: boolean;
    label?: string;
}

function isOutsideByRelativePath(relativePath: string): boolean {
    return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

export function isInsidePath(baseDir: string, targetPath: string, options: PathBoundaryOptions = {}): boolean {
    const root = resolve(baseDir);
    const target = resolve(targetPath);
    const rel = relative(root, target);
    if (rel === '') return options.allowEqual ?? true;
    return !isOutsideByRelativePath(rel);
}

export function resolveInside(baseDir: string, candidatePath: string, options: PathBoundaryOptions = {}): string {
    const root = resolve(baseDir);
    const resolved = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(root, candidatePath);
    if (!isInsidePath(root, resolved, options)) {
        const label = options.label ?? 'path';
        throw new Error(`Path traversal blocked: ${label} resolves outside base directory`);
    }
    return resolved;
}

export function tryResolveInside(baseDir: string, candidatePath: string, options: PathBoundaryOptions = {}): string | null {
    try {
        return resolveInside(baseDir, candidatePath, options);
    } catch {
        return null;
    }
}
