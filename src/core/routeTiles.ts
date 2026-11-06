// Keep the map for offline (0.34.0): the map tiles along a trip's lines, asked only when the person
// taps it. Web Mercator tile numbers, coarse first (each zoom out is a quarter of the tiles below
// it, and what is kept first survives a full cache), one tile either side of the line. Pure.

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Zoom 10 (a region) to 13 (streets named): enough to follow the trip, about 1–3 MB a zoom. */
export const KEEP_ZOOMS = [10, 11, 12, 13] as const;
/** At most this many tiles a trip: half of what the map keeps (800), so it never pushes all out. */
export const KEEP_MAX = 400;

const tileOf = (lon: number, lat: number, z: number) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
};

/** The tiles under the lines (each `[lon, lat][]`) and one either side, coarse zooms first. */
export function tilesAlong(
  lines: [number, number][][],
  zooms: readonly number[] = KEEP_ZOOMS,
  max = KEEP_MAX,
): Tile[] {
  const out: Tile[] = [];
  const seen = new Set<string>();
  for (const z of zooms) {
    // A step of a quarter tile at this zoom, so no tile under the line is jumped over.
    const step = 360 / 2 ** z / 4;
    for (const line of lines)
      for (let i = 0; i < line.length; i++) {
        const [a, b] = [line[i]!, line[i + 1] ?? line[i]!];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
        for (let k = 0; k <= n; k++) {
          const t = tileOf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, z);
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
              const key = `${z}/${t.x + dx}/${t.y + dy}`;
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({ z, x: t.x + dx, y: t.y + dy });
              if (out.length >= max) return out;
            }
        }
      }
  }
  return out;
}

/** A tile's address from a TileJSON template (`…/{z}/{x}/{y}.pbf`). */
export const tileUrl = (template: string, t: Tile) =>
  template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
