// Builds public/data/stops.v1.json from the DIDOK service points (atlas v2, valid today).
// Run: npm run data:stops   (cloud sessions: prefix NODE_USE_ENV_PROXY=1)
// Keeps every stop in CH and LI, abroad only rail, cable and boat stops (Tirano, lake piers).
import { writeFile } from 'node:fs/promises';
import {
  HEIGHT_MIN,
  MODES,
  modeMask,
  type StopIndexFile,
  type StopRow,
} from '../src/core/stops.ts';

const DATASET = 'https://data.opentransportdata.swiss/en/dataset/service-point-v2';
const OUT = 'public/data/stops.v1.json';
const ABROAD = new Set(['TRAIN', 'RACK_RAILWAY', 'CABLE_RAILWAY', 'CABLE_CAR', 'BOAT', 'METRO']);

/** Semicolon CSV with optional double-quoted fields. */
function* parse(text: string): Generator<string[]> {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      yield row;
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) yield [...row, field];
}

// The download link changes when the file is republished: read it from the dataset page.
const pageRes = await fetch(DATASET);
if (!pageRes.ok) throw new Error(`DIDOK dataset page ${pageRes.status}`);
const csvUrl =
  /href="(https:\/\/data\.opentransportdata\.swiss\/[^"]+\/download\/actual-date-swiss-service-point\.csv)"/.exec(
    await pageRes.text(),
  )?.[1];
if (!csvUrl) throw new Error('DIDOK download link not found');
const res = await fetch(csvUrl);
if (!res.ok) throw new Error(`DIDOK ${res.status}`);
const text = (await res.text()).replace(/^\uFEFF/, '');
const it = parse(text);
const head = it.next().value as string[];
const col = (name: string) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`DIDOK column ${name} missing`);
  return i;
};
const C = {
  name: col('designationOfficial'),
  sloid: col('sloid'),
  stop: col('stopPoint'),
  country: col('isoCountryCode'),
  modes: col('meansOfTransport'),
  lat: col('wgs84North'),
  lon: col('wgs84East'),
  validFrom: col('validFrom'),
  height: col('height'),
};

const rows: StopRow[] = [];
let newest = '';
for (const r of it) {
  if (r.length < head.length || r[C.stop] !== 'true' || !r[C.lat]) continue;
  const modes = r[C.modes]!.split('|').filter(Boolean);
  const home = r[C.country] === 'CH' || r[C.country] === 'LI';
  if (!home && !modes.some((m) => ABROAD.has(m))) continue;
  const m = /^ch:1:sloid:(\d+)$/.exec(r[C.sloid]!);
  if (!m) continue;
  for (const x of modes) if (!MODES.includes(x as never)) console.warn(`unknown mode ${x}`);
  rows.push([
    r[C.name]!,
    Number(m[1]),
    Math.round(Number(r[C.lat]) * 1e5) / 1e5,
    Math.round(Number(r[C.lon]) * 1e5) / 1e5,
    modeMask(modes),
    // A height only from HEIGHT_MIN up: the only ones said, and the file stays small.
    ...(Number(r[C.height]) >= HEIGHT_MIN ? [Math.round(Number(r[C.height]))] : []),
  ]);
  if (r[C.validFrom]! > newest && r[C.validFrom]! <= new Date().toISOString().slice(0, 10))
    newest = r[C.validFrom]!;
}
// Stops abroad DIDOK does not list but OJP answers for by their UIC number, at the ends of lines
// the app knows (Mont-Blanc Express, Centovalli). Names and places from OJP's own answer
// (LocationInformationRequest, 4 Nov 2026).
const EXTRA: StopRow[] = [
  ['Domodossola', 8301003, 46.11529, 8.29624, modeMask(['TRAIN', 'BUS'])],
  ['Chamonix-Mont-Blanc', 8774678, 45.92262, 6.87384, modeMask(['TRAIN', 'BUS'])],
  ['Vallorcine', 8774687, 46.0334, 6.93399, modeMask(['TRAIN', 'BUS'])],
];
for (const x of EXTRA) if (!rows.some((r) => r[1] === x[1])) rows.push(x);
rows.sort((a, b) => a[1] - b[1]);
if (rows.length < 20000) throw new Error(`Only ${rows.length} stops: refusing to write`);

const file: StopIndexFile = { v: 1, date: newest, rows };
// One row per line keeps monthly diffs readable.
await writeFile(
  OUT,
  `{"v":1,"date":${JSON.stringify(file.date)},"rows":[\n` +
    rows.map((r) => JSON.stringify(r)).join(',\n') +
    '\n]}\n',
);
console.log(`${rows.length} stops → ${OUT}`);
