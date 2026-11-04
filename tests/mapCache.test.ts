// The map as seen kept in the page (where no service worker does it): the rules, and mapFetch
// against a fake Cache Storage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expired,
  fromProtocol,
  KEPT_AT,
  MAX_AGE_MS,
  mapCacheRule,
  toDrop,
  toProtocol,
} from '../src/core/mapCache';
import { mapFetch, resetMapCache, trim } from '../src/io/mapCache';

const H = 'https://tiles.openfreemap.org';

describe('the rules', () => {
  it('only the tile host: style and TileJSON apart from tiles, glyphs, sprites', () => {
    expect(mapCacheRule(`${H}/styles/positron`)?.name).toBe('srr-mapstyle-v1');
    expect(mapCacheRule(`${H}/planet`)?.strategy).toBe('stale-while-revalidate');
    expect(mapCacheRule(`${H}/planet/20261101_001001_pt/14/8580/5760.pbf`)?.name).toBe(
      'srr-tiles-v1',
    );
    expect(mapCacheRule(`${H}/fonts/Noto%20Sans%20Regular/0-255.pbf`)?.strategy).toBe(
      'cache-first',
    );
    expect(mapCacheRule(`${H}/sprites/ofm_f384/ofm.png`)?.maxEntries).toBe(800);
    expect(mapCacheRule('https://srr-ojp.example.dev/trip')).toBeUndefined();
    expect(mapCacheRule('http://tiles.openfreemap.org/styles/positron')).toBeUndefined();
    expect(mapCacheRule('nonsense')).toBeUndefined();
  });

  it('60 days; a missing or future time is too old', () => {
    const now = 1_000 * MAX_AGE_MS;
    expect(expired(now - MAX_AGE_MS + 1, now)).toBe(false);
    expect(expired(now - MAX_AGE_MS - 1, now)).toBe(true);
    expect(expired(undefined, now)).toBe(true);
    expect(expired(now + 1, now)).toBe(true);
  });

  it('drops the too old, then the oldest beyond the size', () => {
    const now = 10 * MAX_AGE_MS;
    const drop = toDrop(
      [
        ['a', now - 1],
        ['b', now - 3],
        ['c', now - 2],
        ['old', now - MAX_AGE_MS - 1],
        ['none', undefined],
      ],
      2,
      now,
    );
    expect(drop.sort()).toEqual(['b', 'none', 'old']);
  });

  it('the tile host through the app protocol and back; others untouched', () => {
    const u = `${H}/planet/1/2/3.pbf`;
    expect(toProtocol(u)).toBe('srrmap://tiles.openfreemap.org/planet/1/2/3.pbf');
    expect(fromProtocol(toProtocol(u))).toBe(u);
    expect(toProtocol('https://example.com/x.png')).toBe('https://example.com/x.png');
  });
});

/** Cache Storage in memory, as much of it as mapFetch uses. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    const m = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, m);
    const cache = {
      match: async (k: RequestInfo) => m.get(typeof k === 'string' ? k : k.url)?.clone(),
      put: async (k: string, r: Response) => void m.set(k, r),
      keys: async () => [...m.keys()].map((url) => ({ url }) as Request),
      delete: async (k: string) => m.delete(k),
    };
    return cache as unknown as Cache;
  };
  return { stores, caches: { open } as unknown as CacheStorage };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('mapFetch', () => {
  let now = 5 * MAX_AGE_MS;
  beforeEach(() => {
    resetMapCache();
    now = 5 * MAX_AGE_MS;
  });

  it('a tile: kept, then answered from the device; offline too', async () => {
    const { caches, stores } = fakeCaches();
    const fetch = vi.fn(async () => new Response('tile', { status: 200 }));
    const d = { caches, fetch, now: () => now };
    const url = `${H}/planet/x/14/1/2.pbf`;
    expect(await (await mapFetch(url, undefined, d)).text()).toBe('tile');
    await settle();
    expect(stores.get('srr-tiles-v1')?.get(url)?.headers.get(KEPT_AT)).toBe(String(now));
    fetch.mockRejectedValue(new TypeError('offline'));
    expect(await (await mapFetch(url, undefined, d)).text()).toBe('tile');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a tile too old is asked again, the old one kept for when the network fails', async () => {
    const { caches } = fakeCaches();
    const fetch = vi.fn(async () => new Response('v1', { status: 200 }));
    const d = { caches, fetch, now: () => now };
    const url = `${H}/planet/x/14/1/2.pbf`;
    await mapFetch(url, undefined, d);
    await settle();
    now += MAX_AGE_MS + 1;
    fetch.mockResolvedValueOnce(new Response('v2', { status: 200 }));
    expect(await (await mapFetch(url, undefined, d)).text()).toBe('v2');
    await settle();
    now += MAX_AGE_MS + 1;
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    expect(await (await mapFetch(url, undefined, d)).text()).toBe('v2');
  });

  it('the style: at once from the device, refreshed behind it', async () => {
    const { caches, stores } = fakeCaches();
    const fetch = vi.fn(async () => new Response('{"v":1}', { status: 200 }));
    const d = { caches, fetch, now: () => now };
    const url = `${H}/styles/positron`;
    expect(await (await mapFetch(url, undefined, d)).json()).toEqual({ v: 1 });
    await settle();
    fetch.mockResolvedValueOnce(new Response('{"v":2}', { status: 200 }));
    expect(await (await mapFetch(url, undefined, d)).json()).toEqual({ v: 1 });
    await settle();
    expect(await stores.get('srr-mapstyle-v1')!.get(url)!.clone().json()).toEqual({ v: 2 });
  });

  it('only 200s are kept; other hosts are not kept at all; no storage, the network', async () => {
    const { caches, stores } = fakeCaches();
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await mapFetch(`${H}/planet/x/14/1/3.pbf`, undefined, { caches, fetch, now: () => now });
    await mapFetch('https://example.com/a.png', undefined, { caches, fetch, now: () => now });
    await settle();
    expect(stores.get('srr-tiles-v1')?.size ?? 0).toBe(0);
    expect(stores.has('srr-mapstyle-v1')).toBe(false);
    const res = await mapFetch(`${H}/planet/x/14/1/3.pbf`, undefined, {
      caches: undefined,
      fetch,
      now: () => now,
    });
    expect(res.status).toBe(204);
  });

  it('trimmed to its size, the oldest first', async () => {
    const { caches, stores } = fakeCaches();
    const d = { caches, fetch: vi.fn(), now: () => now };
    const cache = await caches.open('srr-tiles-v1');
    for (let i = 0; i < 5; i++)
      await cache.put(
        `${H}/t/${i}.pbf`,
        new Response('x', { headers: { [KEPT_AT]: String(now - i) } }),
      );
    await trim(cache, { name: 'srr-tiles-v1', strategy: 'cache-first', maxEntries: 3 }, d);
    expect([...stores.get('srr-tiles-v1')!.keys()]).toEqual([
      `${H}/t/0.pbf`,
      `${H}/t/1.pbf`,
      `${H}/t/2.pbf`,
    ]);
  });
});
