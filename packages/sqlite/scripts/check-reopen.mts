/**
 * File-replacement check: starts the built server over stdio exactly as an MCP
 * client would, queries, deletes and recreates the file underneath it (what a
 * restore from backup or a regenerated fixture looks like), and queries again.
 * The same server process must answer from the new file without a restart.
 *
 * Usage (after `npm run build`): npx tsx scripts/check-reopen.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-sqlite-reopen-'));
const file = path.join(dir, 'app.db');
const write = (sql: string) => {
    const db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
};
write('create table t (v); insert into t values (1)');

const transport = new StdioClientTransport({
    command: 'node',
    args: [new URL('../dist/src/cli.js', import.meta.url).pathname],
    env: { ...process.env, SQLITE_DATABASE: file } as Record<string, string>,
    stderr: 'pipe',
});
transport.stderr?.on('data', (d: Buffer) =>
    process.stdout.write(`   [server] ${d.toString().trim()}\n`),
);
const client = new Client({ name: 'file-replace', version: '0' });
await client.connect(transport);

const query = async (label: string) => {
    const r = await client.callTool({
        name: 'execute_query',
        arguments: { sql: 'select v from t' },
    });
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
    console.log(`${label}: ${r.isError ? 'ERROR' : 'ok'} -> ${text.slice(0, 120)}`);
    return r.isError ? undefined : text;
};

const first = await query('1. before replacement');
unlinkSync(file);
write('create table t (v); insert into t values (2)');
console.log('>> file deleted and recreated with different contents');
const second = await query('2. after replacement, same server process');
await client.close();
rmSync(dir, { recursive: true, force: true });
const ok = first?.includes('[[1]]') && second?.includes('[[2]]');
console.log(
    ok ? 'RESULT: reopened the new file without restart' : 'RESULT: still serving the old file',
);
process.exit(ok ? 0 : 1);
