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

/** One row: name, SLOID number (`ch:1:sloid:<n>`), lat, lon, mode bitmask (bit i = MODES[i]). */
export type StopRow = [name: string, sloid: number, lat: number, lon: number, modes: number];

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
}

export const modeMask = (modes: readonly string[]) =>
  modes.reduce((m, x) => {
    const i = MODES.indexOf(x as StopMode);
    return i < 0 ? m : m | (1 << i);
  }, 0);

export const toStop = ([name, sloid, lat, lon, mask]: StopRow): Stop => ({
  ref: `ch:1:sloid:${sloid}`,
  name,
  lat,
  lon,
  modes: MODES.filter((_, i) => mask & (1 << i)),
});

/** Lower case, no accents, ß → ss, punctuation to spaces. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

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
  near(at: { lat: number; lon: number }, km: number): (Stop & { km: number })[];
}

/**
 * Ranks: whole name, name start, start of a later word; every query word must start a word of
 * the name. Ties: rail, cable and boat stops before bus-only ones, then shorter names.
 */
export function createStopSearch(file: StopIndexFile): StopSearch {
  const folded = file.rows.map((r) => fold(r[0]));
  const words = folded.map((f) => f.split(' '));
  const byRef = new Map(file.rows.map((r) => [`ch:1:sloid:${r[1]}`, r]));

  return {
    byRef: (ref) => {
      const r = byRef.get(ref);
      return r && toStop(r);
    },
    near(at, km) {
      const out: (Stop & { km: number })[] = [];
      // A box first: most stops are far, and the box is cheap.
      const dLat = km / 111;
      const dLon = km / (111 * Math.cos((at.lat * Math.PI) / 180));
      for (const r of file.rows) {
        if (!(r[4] & RAIL_MASK)) continue;
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
      for (let i = 0; i < file.rows.length; i++) {
        const f = folded[i]!;
        const ws = words[i]!;
        if (!qWords.every((qw) => ws.some((w) => w.startsWith(qw)))) continue;
        const rank = f === q ? 0 : f.startsWith(q) ? 1 : 2;
        const rail = file.rows[i]![4] & RAIL_MASK ? 0 : 1;
        hits.push([i, rank * 1000 + rail * 500 + Math.min(f.length, 499)]);
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
  const didok = /^(\d{7})$/.exec(ref);
  if (didok) {
    const n = didok[1]!;
    return `ch:1:sloid:${n.startsWith('85') ? Number(n.slice(2)) : Number(n)}`;
  }
  return ref;
}
