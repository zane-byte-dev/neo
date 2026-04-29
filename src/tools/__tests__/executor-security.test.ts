import { describe, it, expect } from 'vitest';
import { checkDangerousCommand, safePath } from '../executor.js';
import { resolve } from 'node:path';

describe('checkDangerousCommand', () => {
    describe('blocks dangerous commands', () => {
        it('blocks "rm -rf /"', () => {
            const result = checkDangerousCommand('rm -rf /');
            expect(result.blocked).toBe(true);
        });

        it('blocks "rm -rf /etc"', () => {
            const result = checkDangerousCommand('rm -rf /etc');
            expect(result.blocked).toBe(true);
        });

        it('blocks "rm /usr"', () => {
            const result = checkDangerousCommand('rm /usr');
            expect(result.blocked).toBe(true);
        });

        it('blocks "sudo apt install"', () => {
            const result = checkDangerousCommand('sudo apt install vim');
            expect(result.blocked).toBe(true);
        });

        it('blocks "su -"', () => {
            const result = checkDangerousCommand('su -');
            expect(result.blocked).toBe(true);
        });

        it('blocks "dd if=/dev/zero"', () => {
            const result = checkDangerousCommand('dd if=/dev/zero of=/dev/sda');
            expect(result.blocked).toBe(true);
        });

        it('blocks "mkfs.ext4"', () => {
            const result = checkDangerousCommand('mkfs.ext4 /dev/sda1');
            expect(result.blocked).toBe(true);
        });

        it('blocks "chmod 777 /etc/passwd"', () => {
            const result = checkDangerousCommand('chmod 777 /etc/passwd');
            expect(result.blocked).toBe(true);
        });

        it('blocks "chmod 000 /etc/shadow"', () => {
            const result = checkDangerousCommand('chmod 000 /etc/shadow');
            expect(result.blocked).toBe(true);
        });

        it('blocks redirect to /dev/sda', () => {
            const result = checkDangerousCommand('echo data > /dev/sda');
            expect(result.blocked).toBe(true);
        });
    });

    describe('allows safe commands', () => {
        it('allows "ls -la"', () => {
            const result = checkDangerousCommand('ls -la');
            expect(result.blocked).toBe(false);
        });

        it('allows "cat file.txt"', () => {
            const result = checkDangerousCommand('cat file.txt');
            expect(result.blocked).toBe(false);
        });

        it('allows "npm run build"', () => {
            const result = checkDangerousCommand('npm run build');
            expect(result.blocked).toBe(false);
        });

        it('allows "grep -r pattern ."', () => {
            const result = checkDangerousCommand('grep -r pattern .');
            expect(result.blocked).toBe(false);
        });

        it('allows "rm file.txt" (relative path)', () => {
            const result = checkDangerousCommand('rm file.txt');
            expect(result.blocked).toBe(false);
        });

        it('allows "echo hello"', () => {
            const result = checkDangerousCommand('echo hello');
            expect(result.blocked).toBe(false);
        });

        it('allows "git status"', () => {
            const result = checkDangerousCommand('git status');
            expect(result.blocked).toBe(false);
        });

        it('allows "chmod 644 myfile"', () => {
            const result = checkDangerousCommand('chmod 644 myfile');
            expect(result.blocked).toBe(false);
        });

        it('allows redirecting stderr to /dev/null', () => {
            const result = checkDangerousCommand('grep -n foo bar.txt 2>/dev/null');
            expect(result.blocked).toBe(false);
        });
    });

    it('returns a reason string when blocked', () => {
        const result = checkDangerousCommand('sudo rm -rf /');
        expect(result.blocked).toBe(true);
        expect(result.reason).toBeDefined();
        expect(result.reason!.length).toBeGreaterThan(0);
    });

    it('returns no reason when not blocked', () => {
        const result = checkDangerousCommand('echo hi');
        expect(result.blocked).toBe(false);
        expect(result.reason).toBeUndefined();
    });
});

describe('safePath', () => {
    const workDir = '/home/user/workspace';

    it('resolves relative path within workDir', () => {
        const result = safePath('subdir/file.txt', workDir);
        expect(result).toBe(resolve(workDir, 'subdir/file.txt'));
    });

    it('allows absolute path inside workDir', () => {
        const absPath = resolve(workDir, 'notes/readme.md');
        const result = safePath(absPath, workDir);
        expect(result).toBe(absPath);
    });

    it('blocks path traversal with ../../etc/passwd', () => {
        expect(() => safePath('../../etc/passwd', workDir)).toThrow('Path traversal blocked');
    });

    it('blocks absolute path outside workDir', () => {
        expect(() => safePath('/etc/passwd', workDir)).toThrow('Path traversal blocked');
    });
});
