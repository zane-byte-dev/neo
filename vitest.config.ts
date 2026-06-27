import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['packages/*/src/**/*.test.ts'],
        env: {
            SESSION_SECRET: 'test-secret-for-vitest',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json-summary'],
            include: ['packages/*/src/**/*.ts'],
            exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/__tests__/**'],
        },
    },
});
