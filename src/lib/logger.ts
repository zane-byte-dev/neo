/**
 * Logger Utility for inkClaw
 * Provides global timestamp prefixing for console methods.
 */

export function setupLogger() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalInfo = console.info;
    const originalWarn = console.warn;

    const getTimestamp = () => {
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toTimeString().split(' ')[0];
        return `[${date} ${time}]`;
    };

    console.log = (...args: any[]) => {
        originalLog(getTimestamp(), ...args);
    };

    console.error = (...args: any[]) => {
        originalError(getTimestamp(), ...args);
    };

    console.info = (...args: any[]) => {
        originalInfo(getTimestamp(), ...args);
    };

    console.warn = (...args: any[]) => {
        originalWarn(getTimestamp(), ...args);
    };
}
