// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    // Ignored paths (replaces .eslintignore)
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/*.d.ts',
            'web/dist/**',
            'coverage/**',
            'logs/**',
            'extension/**',
            'examples/**',
            '**/*.config.js',
            '**/*.config.cjs',
            '**/*.config.mjs',
            '**/*.config.ts',
            'packages/agent/src/config.local.ts',
        ],
    },

    // Base JS + TypeScript recommended rules (non type-checked for speed)
    js.configs.recommended,
    ...tseslint.configs.recommended,

    // Project-wide language options and shared rules
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Allow intentionally unused args/vars prefixed with underscore.
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            // `any` is pervasive in the current codebase; surface it without blocking CI.
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-empty': ['warn', { allowEmptyCatch: true }],
        },
    },

    // Frontend (React) specific config
    {
        files: ['web/src/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
        },
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
        },
    },

    // Turn off formatting-related rules that conflict with Prettier.
    prettier,
);
