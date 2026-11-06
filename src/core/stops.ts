// Bundled stop index (built from DIDOK by scripts/build-stops.ts) and its search.

export const MODES = [
  'TRAIN',
  'RACK_RAILWAY',
  'CABLE_RAILWAY',
  'CABLE_CAR',
  'CHAIRLIFT',
  'BOAT',
  'TRAM',
  'METRO',
  'BUS',
  'ELEVATOR',
  'UNKNOWN',
] as const;
export type StopMode = (typeof MODES)[number];

/**
 * One row: name, SLOID number (`ch:1:sloid:<n>`), lat, lon, mode bitmask (bit i = MODES[i]).
 * A stop abroad that DIDOK does not list (Chamonix, Vallorcine, Domodossola) has its UIC number
 * instead (`UIC_MIN` and up: SLOID numbers stay far below), and OJP knows it by that number.
 */
export type StopRow = [
  name: string,
  sloid: number,
  lat: number,
  lon: number,
  modes: number,
  /** Metres above the sea, whole (DIDOK's `height`), only from `HEIGHT_MIN` up (0.40.0). */
  height?: number,
];

/** Heights are kept, and said, from here up: where it is a fact worth knowing (mountains). */
export const HEIGHT_MIN = 1000;

export interface StopIndexFile {
  v: 1;
  /** Date of the DIDOK snapshot, `YYYY-MM-DD`. */
  date: string;
  rows: StopRow[];
}

export interface Stop {
  ref: string;
  name: string;
  lat: number;
  lon: number;
  modes: StopMode[];
  /** Metres above the sea, from `HEIGHT_MIN` up; absent below or unknown. */
  height?: number;
}

export const modeMask = (modes: readonly string[]) =>
  modes.reduce((m, x) => {
    const i = MODES.indexOf(x as StopMode);
    return i < 0 ? m : m | (1 << i);
  }, 0);

/** Row numbers from here are UIC numbers of stops abroad, not SLOIDs (those end near 1.5 M). */
export const UIC_MIN = 8_000_000;

export const toStop = ([name, sloid, lat, lon, mask, height]: StopRow): Stop => ({
  ref: sloid >= UIC_MIN ? String(sloid) : `ch:1:sloid:${sloid}`,
  name,
  lat,
  lon,
  modes: MODES.filter((_, i) => mask & (1 << i)),
  ...(height ? { height } : {}),
});

/**
 * Lower case, no accents, ß → ss, punctuation to spaces, and ä ö ü as their written-out ae oe ue
 * (reported 5 Nov 2026: "Goeschenen" found nothing): both sides fold alike, so Göschenen,
 * Goeschenen and Goschenen are one, and a name with a real "ue" (Hauenstein) still finds itself.
 */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/([aou])e/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A query word this long may hold one typo. */
const TYPO_MIN = 5;
/** Words a station's name may leave out ("Gare de Lausanne" is Lausanne), in the typo pass. */
const FILLER = new Set([
  'gare',
  'bahnhof',
  'bhf',
  'stazione',
  'station',
  'de',
  'du',
  'des',
  'di',
  'von',
]);

/** At most one letter wrong, missing, extra or swapped (Damerau–Levenshtein ≤ 1). */
export function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** A query word of `min`+ letters one typo from the start of a name's word, its first letter right. */
const nearStart = (q: string, w: string, min = TYPO_MIN) =>
  q.length >= min &&
  q[0] === w[0] &&
  [q.length - 1, q.length, q.length + 1].some((n) => n <= w.length && withinOne(q, w.slice(0, n)));

/** How a stop is served, for its icon: by its most lasting way (a station with buses is a station). */
export type StopKind = 'train' | 'cable' | 'boat' | 'tram' | 'bus';
export function stopKind(s: Pick<Stop, 'modes'>): StopKind {
  const m = s.modes;
  if (m.includes('TRAIN') || m.includes('RACK_RAILWAY') || m.includes('METRO')) return 'train';
  if (m.includes('BOAT')) return 'boat';
  if (m.some((x) => x === 'CABLE_CAR' || x === 'CABLE_RAILWAY' || x === 'CHAIRLIFT'))
    return 'cable';
  if (m.includes('TRAM')) return 'tram';
  return m.includes('BUS') ? 'bus' : 'train';
}

const RAIL_MASK = modeMask(['TRAIN', 'RACK_RAILWAY', 'CABLE_RAILWAY', 'CABLE_CAR', 'BOAT']);

/** Kilometres between two points (equirectangular: exact enough within the country). */
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371;
}

/**
 * A place by the name a text gives it (an operator's notice): the stop named just that, else one
 * whose name starts with it ("Genève-Aéroport", "Ebikon"); nothing for a name it cannot tell.
 */
export function placeByName(index: Pick<StopSearch, 'search'>) {
  return (name: string): { lat: number; lon: number } | undefined => {
    const f = fold(name);
    if (!f) return undefined;
    const hits = index.search(name, 5);
    return (
      hits.find((h) => fold(h.name) === f) ?? hits.find((h) => fold(h.name).startsWith(`${f} `))
    );
  };
}

export interface StopSearch {
  search(query: string, limit?: number): Stop[];
  byRef(ref: string): Stop | undefined;
  /** Rail, cable and boat stops within `km` of a point, nearest first, each with its distance. */
  /** Rail, cable and boat stops within `km` of a point, nearest first; with `all`, bus and tram
   *  stops too. */
  near(at: { lat: number; lon: number }, km: number, all?: boolean): (Stop & { km: number })[];
}

/**
 * Ranks: whole name, name start, start of a later word; every query word must start a word of
 * the name. Ties: rail, cable and boat stops before bus-only ones, then shorter names.
 */
export function createStopSearch(
  file: StopIndexFile,
  /** Station name → its names in the other languages ("Genève" → "Genf", "Ginevra"). */
  exonyms: Record<string, string[]> = {},
): StopSearch {
  const folded = file.rows.map((r) => fold(r[0]));
  // Another language's name, typed whole, finds the station first (round 3, 6 Nov 2026:
  // "Ginevra" found a bus stop in Lugano, "Genf" nothing in particular).
  const alias = new Map<string, number>();
  for (const [name, others] of Object.entries(exonyms)) {
    const i = folded.indexOf(fold(name));
    if (i >= 0) for (const o of others) alias.set(fold(o), i);
  }
  const words = folded.map((f) => f.split(' '));
  const byRef = new Map(file.rows.map((r) => [toStop(r).ref, r]));

  return {
    byRef: (ref) => {
      const r = byRef.get(ref);
      if (r) return toStop(r);
      // A station abroad (0.33.0) is not in the index: its ref says where it lies.
      const eu = /^eu:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?):/.exec(ref);
      return eu
        ? { ref, name: '', lat: Number(eu[1]), lon: Number(eu[2]), modes: ['TRAIN'] }
        : undefined;
    },
    near(at, km, all = false) {
      const out: (Stop & { km: number })[] = [];
      // A box first: most stops are far, and the box is cheap.
      const dLat = km / 111;
      const dLon = km / (111 * Math.cos((at.lat * Math.PI) / 180));
      for (const r of file.rows) {
        if (!all && !(r[4] & RAIL_MASK)) continue;
        if (Math.abs(r[2] - at.lat) > dLat || Math.abs(r[3] - at.lon) > dLon) continue;
        const d = kmBetween(at, { lat: r[2], lon: r[3] });
        if (d <= km) out.push({ ...toStop(r), km: d });
      }
      return out.sort((a, b) => a.km - b.km);
    },
    search(query, limit = 8) {
      const q = fold(query);
      if (q.length < 2) return [];
      const qWords = q.split(' ');
      const hits: [number, number][] = [];
      const named = alias.get(q);
      if (named !== undefined) hits.push([named, -1]);
      for (let i = 0; i < file.rows.length; i++) {
        const f = folded[i]!;
        const ws = words[i]!;
        if (i === named || !qWords.every((qw) => ws.some((w) => w.startsWith(qw)))) continue;
        const rank = f === q ? 0 : f.startsWith(q) ? 1 : 2;
        const rail = file.rows[i]![4] & RAIL_MASK ? 0 : 1;
        hits.push([i, rank * 1000 + rail * 500 + Math.min(f.length, 499)]);
      }
      // A typo (retest round 3, 6 Nov 2026: "Gare de Lausane" found nothing): only when the
      // exact pass leaves room, and after every exact hit.
      if (hits.length < limit && qWords.some((w) => w.length >= TYPO_MIN)) {
        const seen = new Set(hits.map(([i]) => i));
        const content = qWords.filter((w) => !FILLER.has(w));
        for (let i = 0; i < file.rows.length && content.length; i++) {
          if (seen.has(i)) continue;
          const ws = words[i]!;
          // A short word may hold a typo too while another word is right ("Interlaken Ots").
          const exact = content.filter((qw) => ws.some((w) => w.startsWith(qw)));
          const min = exact.length ? 3 : TYPO_MIN;
          if (!content.every((qw) => exact.includes(qw) || ws.some((w) => nearStart(qw, w, min))))
            continue;
          const rail = file.rows[i]![4] & RAIL_MASK ? 0 : 1;
          hits.push([i, 3000 + rail * 500 + Math.min(folded[i]!.length, 499)]);
        }
      }
      return hits
        .sort((a, b) => a[1] - b[1])
        .slice(0, limit)
        .map(([i]) => toStop(file.rows[i]!));
    },
  };
}

/**
 * Normalises OJP stop refs to the stop's SLOID: quay refs (`ch:1:sloid:3000:0:7`) to the stop,
 * Swiss DIDOK numbers (`8503000`) to `ch:1:sloid:3000`; other numbers keep their value.
 */
export function stopKey(ref: string): string {
  const sloid = /^ch:1:sloid:(\d+)/.exec(ref);
  if (sloid) return `ch:1:sloid:${Number(sloid[1])}`;
  // A UIC number may carry OJP's generated platform part (`8301003_gen:missingSLOID_pf:31`,
  // Domodossola: reported not reached, round 3).
  const didok = /^(\d{7})(?:_|$)/.exec(ref);
  if (didok) {
    const n = didok[1]!;
    // A stop abroad keeps its UIC number, as OJP knows it by that (Chamonix, `8774678`).
    return n.startsWith('85') ? `ch:1:sloid:${Number(n.slice(2))}` : n;
  }
  return ref;
}
