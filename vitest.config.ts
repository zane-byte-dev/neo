import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
        env: {
            // config.ts calls process.exit(1) if SESSION_SECRET is unset
            SESSION_SECRET: 'test-secret-for-vitest',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/types/**'],
            thresholds: {
                lines: 74,
                functions: 74,
                branches: 58,
                statements: 72,
            },
        },
    },
});
