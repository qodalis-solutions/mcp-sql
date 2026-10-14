import { defineConfig } from 'vitest/config';
import { coreAliases } from './vitest.config.js';

export default defineConfig({
    resolve: { alias: coreAliases },
    test: {
        name: 'sqlite-integration',
        environment: 'node',
        include: ['tests/integration/**/*.test.ts'],
    },
});
