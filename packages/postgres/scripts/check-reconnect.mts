/**
 * Network-loss reconnect check, no root needed.
 *
 * Starts the built server over stdio exactly as an MCP client would, but points
 * it at a local TCP proxy in front of the real database. Killing the proxy
 * resets every socket and refuses new connects (what a VPN drop looks like);
 * restarting it is the VPN coming back. The same server process must answer
 * again without a restart.
 *
 * Usage (after `npm run build`, with POSTGRES_* set for a reachable server):
 *   npx tsx scripts/check-reconnect.mts
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import net from 'node:net';

const upstreamHost = process.env.POSTGRES_HOST!;
const upstreamPort = Number(process.env.POSTGRES_PORT ?? 5432);
const localPort = 15432;
let sockets = new Set<net.Socket>();
let proxy: net.Server | undefined;

const startProxy = () =>
    new Promise<void>((resolve) => {
        proxy = net.createServer((client) => {
            const upstream = net.connect(upstreamPort, upstreamHost);
            sockets.add(client);
            sockets.add(upstream);
            client.pipe(upstream);
            upstream.pipe(client);
            const drop = () => {
                client.destroy();
                upstream.destroy();
                sockets.delete(client);
                sockets.delete(upstream);
            };
            client.on('error', drop);
            upstream.on('error', drop);
            client.on('close', drop);
            upstream.on('close', drop);
        });
        proxy.listen(localPort, '127.0.0.1', () => resolve());
    });
const stopProxy = () =>
    new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        sockets = new Set();
        proxy?.close(() => resolve());
    });

await startProxy();
const transport = new StdioClientTransport({
    command: 'node',
    args: [new URL('../dist/src/cli.js', import.meta.url).pathname],
    env: {
        ...process.env,
        POSTGRES_HOST: '127.0.0.1',
        POSTGRES_PORT: String(localPort),
        POSTGRES_CONNECTION_TIMEOUT: '4000',
    } as Record<string, string>,
    stderr: 'pipe',
});
transport.stderr?.on('data', (d: Buffer) =>
    process.stdout.write(`   [server] ${d.toString().trim()}\n`),
);
const client = new Client({ name: 'network-drop', version: '0' });
await client.connect(transport);

const query = async (label: string) => {
    const started = Date.now();
    const r = await client.callTool({
        name: 'execute_query',
        arguments: { sql: 'select current_database() as db' },
    });
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
    console.log(
        `${label}: ${r.isError ? 'ERROR' : 'ok'} in ${Date.now() - started}ms -> ${text.slice(0, 120).replace(/\n/g, ' ')}`,
    );
    return !r.isError;
};

await query('1. before drop');
await stopProxy();
console.log('>> network dropped (proxy killed, sockets reset)');
await query('2. during outage (expected to fail fast)');
await query('2b. second call during outage');
await startProxy();
console.log('>> network restored (proxy back)');
const ok = await query('3. after restore, same server process');
const ok2 = await query('4. again');
await client.close();
await stopProxy();
console.log(ok && ok2 ? 'RESULT: recovered without restart' : 'RESULT: did NOT recover');
process.exit(ok && ok2 ? 0 : 1);
