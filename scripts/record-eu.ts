// Records Transitous answers for the e2e tests (tests/fixtures/eu/e2e/<sha1 of the app's body>),
// the raw answer the Worker would get, for the bodies a failing e2e lists, one JSON a line.
// NODE_USE_ENV_PROXY=1 npx tsx scripts/record-eu.ts <bodies.txt>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  euPlanUrl,
  euStopsUrl,
  parseEuPlanQuery,
  parseEuStopQuery,
  type EuPlanQuery,
  type EuStopQuery,
} from '../src/core/eu/request';

const BASE = process.env.TRANSITOUS_URL ?? 'https://api.transitous.org';
for (const body of readFileSync(process.argv[2]!, 'utf8').split('\n').filter(Boolean)) {
  const v = JSON.parse(body) as Record<string, unknown>;
  const stops = 'text' in v;
  const q = stops ? parseEuStopQuery(v) : parseEuPlanQuery(v);
  if (typeof q === 'string') throw new Error(`bad question (${q}): ${body}`);
  const url = stops ? euStopsUrl(BASE, q as EuStopQuery) : euPlanUrl(BASE, q as EuPlanQuery);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Viadukt (https://github.com/jibes/swiss-rail-routes)' },
  });
  const text = await res.text();
  const key = createHash('sha1').update(body).digest('hex').slice(0, 12);
  writeFileSync(`tests/fixtures/eu/e2e/${key}.json.gz`, gzipSync(text));
  console.log(key, res.status, text.length);
}
