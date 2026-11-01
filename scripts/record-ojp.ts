// Records OJP 2.0 answers for the acceptance tours (SPEC §8) into tests/fixtures/ojp/.
// Run: OJP_API_KEY=… npm run record:ojp [-- T1 T3 …]   (cloud sessions: prefix NODE_USE_ENV_PROXY=1)
// Stops are resolved by name through LocationInformationRequest first, so no ids are guessed.
// Fixtures are raw XML: the parser is tested against exactly what OJP sent.
import { mkdir, writeFile } from 'node:fs/promises';
import {
  type StopRef,
  type TripQuery,
  stopRequestXml,
  tripRequestXml,
} from '../src/core/ojp/request.ts';

const KEY = process.env.OJP_API_KEY;
const URL_ = process.env.OJP_URL ?? 'https://api.opentransportdata.swiss/ojp20';
const DATE = process.env.OJP_DATE ?? '2026-11-07'; // Saturday; Albula Thusis–Preda closed
const OUT = 'tests/fixtures/ojp';
if (!KEY) throw new Error('Set OJP_API_KEY');

interface Leg {
  from: string;
  to: string;
  vias?: string[];
  notVias?: string[];
  at: string;
}

// Legs as the planner splits them: at every stop; round trips without one at the far end.
const TOURS: Record<string, Leg[]> = {
  T1: [
    {
      from: 'Zürich HB',
      to: 'Alp Grüm',
      vias: ['Chur', 'Filisur', 'Bergün/Bravuogn', 'Preda', 'St. Moritz', 'Pontresina'],
      at: '07:00',
    },
    {
      from: 'Alp Grüm',
      to: 'Zürich HB',
      vias: ['Pontresina', 'Zernez', 'Sagliains', 'Klosters Platz', 'Landquart'],
      at: '13:00',
    },
  ],
  T2: [
    {
      from: 'Zürich HB',
      to: 'Andermatt',
      vias: ['Chur', 'Ilanz', 'Disentis/Mustér', 'Oberalppass'],
      at: '07:30',
    },
    { from: 'Andermatt', to: 'Zürich HB', vias: ['Göschenen'], at: '14:00' },
  ],
  T3: [
    { from: 'Zürich HB', to: 'Luzern', vias: ['St. Gallen', 'Wattwil', 'Biberbrugg'], at: '07:00' },
    {
      from: 'Luzern',
      to: 'Mürren BLM',
      vias: ['Brünig-Hasliberg', 'Interlaken Ost', 'Lauterbrunnen', 'Grütschalp'],
      at: '11:00',
    },
    { from: 'Mürren BLM', to: 'Zürich HB', vias: ['Interlaken Ost', 'Bern'], at: '15:30' },
  ],
  T4: [
    { from: 'Zürich HB', to: 'Rigi Kulm', vias: ['Arth-Goldau'], at: '08:00' },
    { from: 'Rigi Kulm', to: 'Zürich HB', vias: ['Vitznau', 'Luzern'], at: '12:00' },
  ],
  T5: [{ from: 'Interlaken Ost', to: 'Kleine Scheidegg', at: '09:00' }],
  T6: [
    { from: 'Zürich HB', to: 'Lugano', vias: ['Göschenen'], at: '08:00' },
    // Unconstrained: gives the base-tunnel candidates the filter must reject.
    { from: 'Zürich HB', to: 'Lugano', at: '08:00' },
  ],
};

const now = () => new Date();
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase();

async function post(xml: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/xml' },
      body: xml,
    });
    const text = await res.text();
    if (res.ok) return text;
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    throw new Error(`OJP ${res.status}: ${text.slice(0, 300)}`);
  }
}

const stops = new Map<string, StopRef>();
async function resolve(name: string): Promise<StopRef> {
  const hit = stops.get(name);
  if (hit) return hit;
  const xml = await post(stopRequestXml({ text: name, results: 5 }, now(), 'swiss-rail-routes'));
  await mkdir(`${OUT}/stops`, { recursive: true });
  await writeFile(`${OUT}/stops/${slug(name)}.xml`, xml);
  const ref = /<StopPlaceRef>([^<]+)<\/StopPlaceRef>/.exec(xml)?.[1];
  const found = /<StopPlaceName>\s*<Text[^>]*>([^<]+)<\/Text>/.exec(xml)?.[1];
  if (!ref) throw new Error(`No stop for "${name}"`);
  if (found && found !== name) console.warn(`  "${name}" → "${found}" (${ref}): check`);
  const stop = { ref, name: found ?? name };
  stops.set(name, stop);
  return stop;
}

const only = process.argv.slice(2);
const manifest: Record<string, unknown[]> = {};
for (const [tour, legs] of Object.entries(TOURS)) {
  if (only.length && !only.includes(tour)) continue;
  console.log(tour);
  await mkdir(`${OUT}/${tour}`, { recursive: true });
  manifest[tour] = [];
  for (const [i, leg] of legs.entries()) {
    const q: TripQuery = {
      origin: await resolve(leg.from),
      destination: await resolve(leg.to),
      vias: await Promise.all((leg.vias ?? []).map(resolve)),
      notVias: [],
      time: `${DATE}T${leg.at}`,
      arriveBy: false,
      results: 6,
    };
    const xml = await post(tripRequestXml(q, now(), 'swiss-rail-routes'));
    const file = `${OUT}/${tour}/leg${i}.xml`;
    await writeFile(file, xml);
    const n = (xml.match(/<TripResult>/g) ?? []).length;
    console.log(
      `  leg${i} ${leg.from} → ${leg.to}: ${n} results, ${(xml.length / 1024).toFixed(0)} KB`,
    );
    manifest[tour]!.push({ file: `leg${i}.xml`, query: q });
  }
}
await writeFile(
  `${OUT}/manifest.json`,
  JSON.stringify({ recorded: now().toISOString(), date: DATE, tours: manifest }, null, 2) + '\n',
);
