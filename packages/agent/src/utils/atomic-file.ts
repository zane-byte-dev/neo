import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

function tempPathFor(targetPath: string): string {
    return join(
        dirname(targetPath),
        `.${basename(targetPath)}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`,
    );
}

export async function writeFileAtomic(targetPath: string, data: string | Uint8Array): Promise<void> {
    await mkdir(dirname(targetPath), { recursive: true });
    const tmp = tempPathFor(targetPath);
    try {
        await writeFile(tmp, data);
        await rename(tmp, targetPath);
    } catch (err) {
        await rm(tmp, { force: true }).catch(() => {});
        throw err;
    }
}

export async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
    await writeFileAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}
