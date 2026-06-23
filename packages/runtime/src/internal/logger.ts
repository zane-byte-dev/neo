type LogFields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error' | 'debug', module: string, message: string, fields?: LogFields): void {
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
    const line = `[${module}] ${message}${suffix}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'debug') console.debug(line);
    else console.info(line);
}

export const log = {
    info: (module: string, message: string, fields?: LogFields) => write('info', module, message, fields),
    warn: (module: string, message: string, fields?: LogFields) => write('warn', module, message, fields),
    error: (module: string, message: string, fields?: LogFields) => write('error', module, message, fields),
    debug: (module: string, message: string, fields?: LogFields) => write('debug', module, message, fields),
};
