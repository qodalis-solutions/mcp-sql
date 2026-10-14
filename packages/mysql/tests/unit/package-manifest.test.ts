/**
 * Guards the published manifest: every bare package imported from src/ must be
 * declared in dependencies. Inside the workspace a missing dependency still
 * resolves through the symlinked node_modules, so only this test (and the
 * packed-install check in CI) catches a release that cannot install.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const manifest = require('../../package.json') as {
    dependencies?: Record<string, string>;
    name: string;
};

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory()
            ? sourceFiles(path)
            : path.endsWith('.ts')
              ? [path]
              : [];
    });

const packageNameOf = (specifier: string): string =>
    specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] ?? specifier);

const importedPackages = (): Set<string> => {
    const names = new Set<string>();
    for (const file of sourceFiles(join(import.meta.dirname, '../../src'))) {
        for (const match of readFileSync(file, 'utf8').matchAll(/from\s+'([^'.][^']*)'/g)) {
            const specifier = match[1] ?? '';
            if (!specifier.startsWith('node:')) {
                names.add(packageNameOf(specifier));
            }
        }
    }
    return names;
};

describe(`${manifest.name} package manifest`, () => {
    it('declares every package imported from src/ as a dependency', () => {
        const declared = Object.keys(manifest.dependencies ?? {});
        const missing = [...importedPackages()].filter((name) => !declared.includes(name)).sort();

        expect(missing).toEqual([]);
    });

    it('depends on the shared core', () => {
        expect(manifest.dependencies?.['@qodalis/mcp-sql-core']).toMatch(/^\^0\./);
    });
});
