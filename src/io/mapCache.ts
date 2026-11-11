// The map as seen, kept in the page's Cache Storage where no service worker does it: the
// Android shell (which has none) and a web page its worker does not control yet. Only what the
// map asks for is kept, nothing is fetched ahead (but a trip's route when the person asks: ui/keepMap.ts), so the tile host learns nothing new. The
// rules are in core/mapCache.ts; a storage failure only means asking the network.
import {
  expired,
  KEPT_AT,
  mapCacheRule,
  tileKey,
  toDrop,
  type MapCacheName,
  type MapCacheRule,
} from '../core/mapCache';
import { log } from './log';

export interface MapCacheDeps {
  caches?: CacheStorage;
  fetch: typeof fetch;
  now: () => number;
}

const realDeps = (): MapCacheDeps => ({
  caches: typeof caches === 'undefined' ? undefined : caches,
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
});

/** Every this many answers kept, a cache is trimmed to its size. */
const TRIM_EVERY = 50;
const kept = new Map<MapCacheName, number>();

const keptAt = (r: Response | undefined) => {
  const v = r?.headers.get(KEPT_AT);
  return v ? Number(v) : undefined;
};

/**
 * When an entry was kept, for trimming: its own time, else the time the host answered it, as
 * the service worker keeps entries in the same caches without ours (third audit, 11 Nov 2026:
 * the page's first trim dropped every one of them).
 */
const keptOrServed = (r: Response | undefined) => {
  const at = keptAt(r);
  if (at !== undefined) return at;
  const served = Date.parse(r?.headers.get('date') ?? '');
  return Number.isFinite(served) ? served : undefined;
};

async function keep(cache: Cache, rule: MapCacheRule, url: string, res: Response, d: MapCacheDeps) {
  if (res.status !== 200) return;
  try {
    const headers = new Headers(res.headers);
    headers.set(KEPT_AT, String(d.now()));
    const body = await res.clone().arrayBuffer();
    await cache.put(tileKey(url), new Response(body, { status: 200, statusText: 'OK', headers }));
    const n = (kept.get(rule.name) ?? 0) + 1;
    kept.set(rule.name, n);
    if (n % TRIM_EVERY === 1) await trim(cache, rule, d);
  } catch (e) {
    // A tile the map no longer wanted (panned past, closed): its body was cut off, nothing kept.
    if ((e as Error).name !== 'AbortError') log('mapcache.keep.fail', { e });
  }
}

/** Drops what is too old and the oldest beyond the rule's size. */
export async function trim(cache: Cache, rule: MapCacheRule, d: MapCacheDeps = realDeps()) {
  const keys = await cache.keys();
  const entries = await Promise.all(
    keys.map(async (k): Promise<[string, number | undefined]> => [
      k.url,
      keptOrServed(await cache.match(k)),
    ]),
  );
  const drop = toDrop(entries, rule.maxEntries, d.now());
  await Promise.all(drop.map((k) => cache.delete(k)));
  if (drop.length)
    log('mapcache.trim', {
      cache: rule.name,
      kept: keys.length - drop.length,
      dropped: drop.length,
    });
}

/**
 * `fetch` for the tile host's addresses, answered from what is kept as the rule says (style and
 * TileJSON at once and refreshed behind; tiles, glyphs and sprites kept first, the network once
 * too old or missing, the old one when the network fails). Other addresses: the network.
 */
export async function mapFetch(
  url: string,
  signal?: AbortSignal,
  d: MapCacheDeps = realDeps(),
): Promise<Response> {
  const rule = mapCacheRule(url);
  if (!rule || !d.caches) return d.fetch(url, { signal });
  const cache = await d.caches.open(rule.name).catch(() => undefined);
  if (!cache) return d.fetch(url, { signal });
  const hit = await cache.match(tileKey(url)).catch(() => undefined);
  const fresh = hit && !expired(keptAt(hit), d.now());
  if (rule.strategy === 'stale-while-revalidate' && hit) {
    void d
      .fetch(url)
      .then((res) => keep(cache, rule, url, res, d))
      .catch(() => {});
    return hit;
  }
  if (fresh) return hit;
  try {
    const res = await d.fetch(url, { signal });
    // Kept on the side (its body cloned at once): the map need not wait for the write.
    void keep(cache, rule, url, res, d);
    return res;
  } catch (e) {
    if (hit && !signal?.aborted) return hit;
    throw e;
  }
}

/** For tests: forget the counts of answers kept. */
export const resetMapCache = () => kept.clear();
