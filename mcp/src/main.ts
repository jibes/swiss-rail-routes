// The Viadukt MCP server. Env: MCP_KEYS, MCP_PORT, OJP_WORKER_URL, MCP_SECRET (deprecated); see
// mcp/README.md. `node server.mjs key create|list|revoke` manages the API keys.
import { readFileSync } from 'node:fs';
import { fileKeys, keyCommand, readKeys } from './keys';
import { createStopSearch, type StopIndexFile } from '../../src/core/stops';
import { EXONYMS, GA, TEMPLATES } from '../../src/data';
import { createHttpServer } from './server';
import { createTools } from './tools';
import { createWorker } from './worker';

const keysPath = process.env.MCP_KEYS ?? '/app/keys/keys.json';
if (process.argv[2] === 'key')
  process.exit(keyCommand(process.argv.slice(3), keysPath, (l) => console.log(l)));

const { MCP_SECRET: secret, MCP_PORT: port, OJP_WORKER_URL: url } = process.env;
if (secret !== undefined && secret.length < 32)
  throw new Error('MCP_SECRET: at least 32 characters');
if (!url) throw new Error('OJP_WORKER_URL is not set');
const count = readKeys(keysPath).length;
console.log(JSON.stringify({ keys: count, legacy: Boolean(secret) }));
if (!count && !secret)
  console.log(JSON.stringify({ warning: 'no keys: every request is refused' }));

const stops = JSON.parse(
  readFileSync(new URL('./stops.v1.json', import.meta.url), 'utf8'),
) as StopIndexFile;

const index = createStopSearch(stops, EXONYMS);
const server = createHttpServer({
  keys: fileKeys(keysPath, secret, (e) =>
    console.log(JSON.stringify({ outcome: 'keys-unreadable', kind: (e as Error).name })),
  ),
  tools: createTools({
    index,
    timetable: createWorker({ url, index }),
    templates: TEMPLATES,
    ga: GA,
    publicUrl: process.env.VIADUKT_URL ?? 'https://jibes.github.io/swiss-rail-routes/',
  }),
});
server.listen(Number(port ?? 8049), '0.0.0.0', () => console.log(JSON.stringify({ up: true })));

for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
