// Records fare answers for the e2e tests (tests/fixtures/fares/<sha1>: OJP's trip, OJP Fare's
// answer), for the fare questions the app asks, one JSON per line in the file given.
// The trip comes through the Worker (OJP_RECORD_URL); OJP Fare is asked directly with
// OJP_FARE_API_KEY. NODE_USE_ENV_PROXY=1 npx tsx scripts/record-fares.ts <bodies.txt>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fareRequestXml, parseFareQuery, pickTrip } from '../src/core/ojp/fareRequest';

const WORKER = process.env.OJP_RECORD_URL ?? 'https://srr-ojp.sebastian-9fc.workers.dev';
const KEY = process.env.OJP_FARE_API_KEY ?? 'proxy-injected';
for (const body of readFileSync(process.argv[2]!, 'utf8').split('\n').filter(Boolean)) {
  const q = parseFareQuery(JSON.parse(body));
  if (typeof q === 'string') throw new Error(`bad question (${q}): ${body}`);
  const res = await fetch(`${WORKER.replace(/[/]$/, '')}/trip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' },
    body: JSON.stringify({ ...q, notVias: [], arriveBy: false, results: 6 }),
  });
  const trips = await res.text();
  const trip = pickTrip(trips, q.journeys);
  if (!trip) {
    console.log('no such trip', body);
    continue;
  }
  const fare = await fetch('https://api.opentransportdata.swiss/ojpfare', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/xml' },
    body: fareRequestXml(trip, q, new Date(), 'swiss-rail-routes'),
  });
  const answer = await fare.text();
  const key = createHash('sha1').update(body).digest('hex').slice(0, 12);
  writeFileSync(`tests/fixtures/fares/${key}-trip.xml.gz`, gzipSync(trips));
  writeFileSync(`tests/fixtures/fares/${key}.xml.gz`, gzipSync(answer));
  console.log(key, fare.status, (answer.match(/<(?:\w+:)?Price>[^<]*/g) ?? []).join(' '));
}
