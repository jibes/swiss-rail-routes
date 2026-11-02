// The Viadukt MCP server. Env: MCP_SECRET, MCP_PORT, OJP_WORKER_URL (see mcp/README.md).
import { readFileSync } from 'node:fs';
import { createStopSearch, type StopIndexFile } from '../../src/core/stops';
import { GA, TEMPLATES } from '../../src/data';
import { createHttpServer } from './server';
import { createTools } from './tools';
import { createWorker } from './worker';

const { MCP_SECRET: secret, MCP_PORT: port, OJP_WORKER_URL: url } = process.env;
if (!secret || secret.length < 32) throw new Error('MCP_SECRET: at least 32 characters');
if (!url) throw new Error('OJP_WORKER_URL is not set');

const stops = JSON.parse(
  readFileSync(new URL('./stops.v1.json', import.meta.url), 'utf8'),
) as StopIndexFile;

const server = createHttpServer({
  secret,
  tools: createTools({
    index: createStopSearch(stops),
    timetable: createWorker({ url }),
    templates: TEMPLATES,
    ga: GA,
    publicUrl: process.env.VIADUKT_URL ?? 'https://jibes.github.io/swiss-rail-routes/',
  }),
});
server.listen(Number(port ?? 8049), '0.0.0.0', () => console.log(JSON.stringify({ up: true })));

for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
