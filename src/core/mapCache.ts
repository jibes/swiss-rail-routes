// The map as seen, kept on the device: which cache an address of the tile host goes to, how it
// is read, when an entry is too old, and which go when there are too many. The same rules as
// the service worker's (`MAP_CACHING` in vite.config.ts), for where there is none: the Android
// shell, and a web page before its worker controls it.

export const TILE_HOST = 'tiles.openfreemap.org';

export type MapCacheName = 'srr-mapstyle-v1' | 'srr-tiles-v1';

export interface MapCacheRule {
  name: MapCacheName;
  /** Style and TileJSON: what is kept at once, refreshed behind it. Tiles, glyphs, sprites:
   *  what is kept, else the network. */
  strategy: 'stale-while-revalidate' | 'cache-first';
  maxEntries: number;
}

export const MAX_AGE_MS = 60 * 24 * 3600_000;

/** The header a kept answer carries its time in (the Cache API keeps none). */
export const KEPT_AT = 'x-srr-kept-at';

const STYLE: MapCacheRule = {
  name: 'srr-mapstyle-v1',
  strategy: 'stale-while-revalidate',
  maxEntries: 20,
};
const TILES: MapCacheRule = { name: 'srr-tiles-v1', strategy: 'cache-first', maxEntries: 800 };

/** The rule for an address, or none: only the tile host's answers are kept. */
export function mapCacheRule(url: string): MapCacheRule | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.host !== TILE_HOST) return undefined;
  // Addresses with a file extension are tiles, glyphs and sprites; without one, style and
  // TileJSON (which name the tiles of the week's planet build).
  return /\.[a-z0-9]+$/i.test(u.pathname) ? TILES : STYLE;
}

/**
 * The key a tile is kept under: its address without the week's planet build
 * (`/planet/20261105_001001_pt/…`), so tiles kept for offline outlive a new build, which the
 * TileJSON names once it is refreshed (third audit, 11 Nov 2026). The service worker writes the
 * same (`PLANET_BUILD` inlined in vite.config.ts, as its rules are copied into it as text).
 */
export const PLANET_BUILD = /\/planet\/[^/]+\/(?=\d+\/\d+\/\d+\.)/;
export const tileKey = (url: string) => url.replace(PLANET_BUILD, '/planet/_/');

/** Whether a kept answer is too old to stand (a missing or bad time counts as too old). */
export function expired(keptAt: number | undefined, now: number): boolean {
  return (
    !(typeof keptAt === 'number' && Number.isFinite(keptAt) && keptAt <= now) ||
    now - keptAt > MAX_AGE_MS
  );
}

/** The keys to drop: those too old, then the oldest beyond `max`. */
export function toDrop(entries: [string, number | undefined][], max: number, now: number) {
  const drop: string[] = [];
  const keep: [string, number][] = [];
  for (const [k, at] of entries) {
    if (expired(at, now)) drop.push(k);
    else keep.push([k, at!]);
  }
  keep.sort((a, b) => b[1] - a[1]);
  for (const [k] of keep.slice(max)) drop.push(k);
  return drop;
}

/** The address MapLibre asks through the app's own protocol, so the page can answer it. */
export const MAP_PROTOCOL = 'srrmap';

export const toProtocol = (url: string) =>
  mapCacheRule(url) ? `${MAP_PROTOCOL}://${url.slice('https://'.length)}` : url;

export const fromProtocol = (url: string) =>
  url.startsWith(`${MAP_PROTOCOL}://`) ? `https://${url.slice(MAP_PROTOCOL.length + 3)}` : url;
