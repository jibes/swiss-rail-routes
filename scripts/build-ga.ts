// Builds src/data/ga.json from the OSDM fare data on opentransportdata.swiss (SBB, fare provider
// 1185): every stretch where a 2nd-class GA fare is not zero, with its share of the full fare.
// Run: npm run data:ga   (cloud sessions: prefix NODE_USE_ENV_PROXY=1)
// The OSDM data covers the fares SBB sells; stretches sold only by other operators are absent.
import { readFile, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import type { GaData, GaRule } from '../src/core/data.ts';
import { createStopSearch, stopKey, type Stop, type StopIndexFile } from '../src/core/stops.ts';

const DATASET = 'https://data.opentransportdata.swiss/en/dataset/osdm-offline';
const OUT = 'src/data/ga.json';

interface Price {
  id: string;
  price: { amount: number }[];
}
interface Fare {
  priceRef: string;
  regionalConstraintRef: string;
  reductionConstraintRef?: string;
  passengerConstraintRef: string;
  serviceClassRef: string;
}
interface Regional {
  id: string;
  regionalValidity: { viaStations?: { route: { station?: { code: string } }[] } }[];
}

// The download link changes with each delivery: read it from the dataset page.
const page = await (await fetch(DATASET)).text();
const zipUrl =
  /href="(https:\/\/data\.opentransportdata\.swiss\/[^"]+\/download\/osdm[^"]+\.zip)"/.exec(
    page,
  )?.[1];
if (!zipUrl) throw new Error('OSDM download link not found');
const zip = unzipSync(new Uint8Array(await (await fetch(zipUrl)).arrayBuffer()));
const json = Object.entries(zip).find(([n]) => n.endsWith('.json'));
if (!json) throw new Error('no JSON in OSDM zip');
const delivery = JSON.parse(new TextDecoder().decode(json[1])).fareDelivery;
const s = delivery.fareStructure as {
  prices: Price[];
  fares: Fare[];
  regionalConstraints: Regional[];
};

const stops = createStopSearch(
  JSON.parse(await readFile('public/data/stops.v1.json', 'utf8')) as StopIndexFile,
);
/**
 * A fare names a place's main station; the ride may leave from another stop there (the cable
 * car to Birg from Mürren (Schilthornbahn), the fare from Mürren BLM). When the two ends share no
 * mode, the end is moved to the nearest stop within 1 km that has the other end's mode.
 */
function served(a?: Stop, b?: Stop): [Stop | undefined, Stop | undefined] {
  if (!a || !b || a.modes.some((m) => b.modes.includes(m))) return [a, b];
  const near = (x: Stop, y: Stop) =>
    stops.near(x, 1).find((s) => s.ref !== y.ref && s.modes.some((m) => y.modes.includes(m)));
  const a2 = near(a, b);
  if (a2) return [a2, b];
  const b2 = near(b, a);
  return b2 ? [a, b2] : [a, b];
}

const amount = new Map(s.prices.map((p) => [p.id, p.price[0]!.amount]));
const regional = new Map(s.regionalConstraints.map((r) => [r.id, r]));
const isAdult2nd = (f: Fare) =>
  f.passengerConstraintRef === 'ADULT' && f.serviceClassRef === 'BASIC';
const fullFare = new Map(
  s.fares
    .filter((f) => isAdult2nd(f) && !f.reductionConstraintRef)
    .map((f) => [f.regionalConstraintRef, f.priceRef]),
);

const sections = new Map<string, GaData['sections'][number]>();
for (const f of s.fares) {
  if (f.reductionConstraintRef !== 'GA_2KL_CONSTRAINT' || amount.get(f.priceRef) === 0) continue;
  const full = amount.get(fullFare.get(f.regionalConstraintRef) ?? '');
  const share = full ? amount.get(f.priceRef)! / full : NaN;
  const rule: GaRule = Math.abs(share - 0.5) < 0.05 ? 'half' : 'reduced';
  const route = (regional.get(f.regionalConstraintRef)?.regionalValidity ?? [])
    .flatMap((v) => v.viaStations?.route ?? [])
    .map((x) => (x.station ? stops.byRef(stopKey(x.station.code)) : undefined));
  // Each pair of consecutive known stations is a stretch a ride can be checked against.
  for (let i = 0; i + 1 < route.length; i++) {
    const [a, b] = served(route[i], route[i + 1]);
    if (!a || !b) continue;
    const [x, y] = a.ref < b.ref ? [a, b] : [b, a];
    sections.set(`${x.ref}|${y.ref}`, { from: x.ref, to: y.ref, names: [x.name, y.name], rule });
  }
}
// Abroad, past the border station: SBB sells no fare there, so OSDM says nothing, and the GA and
// day passes end at the border (Le Châtelard-Frontière; beyond is SNCF). Stops abroad go by
// their UIC number (src/core/stops.ts).
const ABROAD: GaData['sections'] = [
  {
    from: '8774687',
    to: 'ch:1:sloid:1568',
    names: ['Vallorcine', 'Le Châtelard-Frontière'],
    rule: 'none',
  },
  { from: '8774678', to: '8774687', names: ['Chamonix-Mont-Blanc', 'Vallorcine'], rule: 'none' },
];
for (const x of ABROAD) sections.set(`${x.from}|${x.to}`, x);
if (sections.size < 5) throw new Error(`Only ${sections.size} GA sections: refusing to write`);

const current = JSON.parse(await readFile(OUT, 'utf8')) as GaData;
const out: GaData & { source: string } = {
  version: `osdm ${delivery.delivery.deliveryId}`,
  source: DATASET,
  reviewed: null,
  sections: [...sections.values()].sort((a, b) => a.names.join().localeCompare(b.names.join())),
  supplementTrains: current.supplementTrains,
};
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`${out.sections.length} GA sections from OSDM ${out.version} → ${OUT}`);
