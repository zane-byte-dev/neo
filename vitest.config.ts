import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        env: {
            SESSION_SECRET: 'test-secret-for-vitest',
        },
    },
});
