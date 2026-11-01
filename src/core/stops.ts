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

export interface StopSearch {
  search(query: string, limit?: number): Stop[];
  byRef(ref: string): Stop | undefined;
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
