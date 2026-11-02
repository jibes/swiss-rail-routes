// OJP for the acceptance tests: replay recorded answers (default), record them
// (RECORD_OJP=1 with OJP_API_KEY), or ask the live Worker (OJP_LIVE_URL, used by live.yml).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Connection } from '../../src/core/model';
import { parseTrips } from '../../src/core/ojp/parse';
import { parseTripQuery, tripRequestXml, type TripQuery } from '../../src/core/ojp/request';

const DIR = 'tests/fixtures/ojp';
export const RECORD = process.env.RECORD_OJP === '1';
export const LIVE_URL = process.env.OJP_LIVE_URL;
/** Records only answers not yet stored, through the app's own Worker (no key needed):
 * `OJP_RECORD_URL=https://srr-ojp….workers.dev npm run record:ojp:missing`. */
const RECORD_URL = process.env.OJP_RECORD_URL;
export const FIXTURE_DATE = '2026-11-07';

/**
 * Stored answers keep every 20th track point (and the last of each projection): the tracks are
 * ~80 % of an answer and tests need their shape, not their density. Everything else is verbatim.
 */
export function thinTracks(xml: string): string {
  return xml.replace(/<LinkProjection>([\s\S]*?)<\/LinkProjection>/g, (_, inner: string) => {
    const pts = inner.match(/<Position>[\s\S]*?<\/Position>/g) ?? [];
    const keep = pts.filter((_p, i) => i % 20 === 0);
    if (pts.length && (pts.length - 1) % 20) keep.push(pts.at(-1)!);
    return `<LinkProjection>${keep.join('')}</LinkProjection>`;
  });
}

const keyOf = (q: TripQuery) =>
  createHash('sha1').update(JSON.stringify(q)).digest('hex').slice(0, 12);

interface IndexEntry {
  from: string;
  to: string;
  via: string[];
  time: string;
}
type Index = Record<string, IndexEntry>;

function readIndex(tour: string): Index {
  const f = `${DIR}/${tour}/index.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Index) : {};
}

async function post(url: string, init: RequestInit): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      const body = await res.text();
      if (res.ok) return body;
      if (res.status !== 429 || attempt >= 3)
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
}

export function ojpFor(tour: string) {
  const index = readIndex(tour);
  const fetchTrips = async (q: TripQuery): Promise<Connection[]> => {
    // What the Worker would refuse (400) fails here, not only in the nightly live run.
    const checked = parseTripQuery(q);
    if (typeof checked === 'string')
      throw new Error(`${tour}: the Worker would refuse this query (${checked})`);
    const key = keyOf(q);
    const file = `${DIR}/${tour}/${key}.xml.gz`;
    if (LIVE_URL) {
      return parseTrips(
        await post(`${LIVE_URL.replace(/[/]$/, '')}/trip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(q),
        }),
      );
    }
    if (RECORD || (RECORD_URL && !existsSync(file))) {
      const xml = RECORD_URL
        ? await post(`${RECORD_URL.replace(/[/]$/, '')}/trip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(q),
          })
        : await post('https://api.opentransportdata.swiss/ojp20', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.OJP_API_KEY}`,
              'Content-Type': 'application/xml',
            },
            body: tripRequestXml(q, new Date(), 'swiss-rail-routes'),
          });
      mkdirSync(`${DIR}/${tour}`, { recursive: true });
      writeFileSync(file, gzipSync(thinTracks(xml), { level: 9 }));
      index[key] = {
        from: q.origin.name,
        to: q.destination.name,
        via: q.vias.map((v) => v.name),
        time: q.time,
      };
      writeFileSync(`${DIR}/${tour}/index.json`, JSON.stringify(index, null, 2) + '\n');
      return parseTrips(xml);
    }
    if (!existsSync(file))
      throw new Error(
        `${tour}: no recorded answer for ${q.origin.name} → ${q.destination.name} via [${q.vias
          .map((v) => v.name)
          .join(', ')}] at ${q.time}. Re-record: NODE_USE_ENV_PROXY=1 npm run record:ojp`,
      );
    return parseTrips(gunzipSync(readFileSync(file)).toString('utf8'));
  };
  return { fetchTrips };
}
