import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEnvFile, parseEnvFile } from '../../src/env-file.js';

describe('parseEnvFile', () => {
    it('parses KEY=value lines, ignoring comments and blank lines', () => {
        const parsed = parseEnvFile(
            '# comment\n\nSQLSERVER_HOST=db\nexport SQLSERVER_USER = reader \n',
        );

        expect(parsed).toEqual({ SQLSERVER_HOST: 'db', SQLSERVER_USER: 'reader' });
    });

    it('supports single and double quoted values with escapes and inline comments', () => {
        const parsed = parseEnvFile(
            'A="x y" # note\nB=\'it#s\'\nC="line\\nbreak"\nD=plain # trailing',
        );

        expect(parsed).toEqual({ A: 'x y', B: 'it#s', C: 'line\nbreak', D: 'plain' });
    });

    it('keeps a password containing = and # intact when quoted', () => {
        expect(parseEnvFile('SQLSERVER_PASSWORD="p=a#ss"')).toEqual({
            SQLSERVER_PASSWORD: 'p=a#ss',
        });
    });
});

describe('applyEnvFile', () => {
    it('loads the file into the env without overriding values already set', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mcp-sqlserver-'));
        const file = join(dir, '.env');
        writeFileSync(file, 'SQLSERVER_HOST=from-file\nSQLSERVER_USER=from-file\n');
        const env: Record<string, string | undefined> = { SQLSERVER_HOST: 'from-process' };

        applyEnvFile(file, env);

        expect(env).toEqual({ SQLSERVER_HOST: 'from-process', SQLSERVER_USER: 'from-file' });
    });

    it('fails loudly when the file does not exist', () => {
        expect(() => applyEnvFile('/nonexistent/.env', {})).toThrow(/nonexistent/);
    });
});
