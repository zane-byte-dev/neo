import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'packages/app/src/pi/extensions');
const destination = resolve(root, 'packages/app/dist/pi/extensions');
const skillSource = resolve(root, 'pi/skills');
const skillDestination = resolve(root, 'packages/app/dist/pi/skills');

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await mkdir(skillDestination, { recursive: true });
await cp(skillSource, skillDestination, { recursive: true });
