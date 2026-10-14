import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: ['packages/*/vitest.config.ts', 'packages/*/vitest.integration.config.ts'],
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**/*.ts'],
            exclude: ['packages/*/src/cli.ts', 'packages/*/src/testing/**'],
            reporter: ['text', 'lcov'],
            thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
        },
    },
});
