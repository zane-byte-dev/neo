import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        env: {
            // config.ts calls process.exit(1) if SESSION_SECRET is unset
            SESSION_SECRET: 'test-secret-for-vitest',
        },
    },
});
