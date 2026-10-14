import path from 'node:path';
import { defineConfig } from 'vitest/config';

const core = path.resolve(import.meta.dirname, '../core/src');

export const coreAliases = [
    { find: '@qodalis/mcp-sql-core/testing', replacement: path.join(core, 'testing/index.ts') },
    { find: '@qodalis/mcp-sql-core', replacement: path.join(core, 'index.ts') },
];

export default defineConfig({
    resolve: { alias: coreAliases },
    test: {
        name: 'sqlserver',
        environment: 'node',
        include: ['tests/unit/**/*.test.ts'],
    },
});
