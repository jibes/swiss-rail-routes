import { describe, expect, it } from 'vitest';
import {
  deriveKeys,
  formatKey,
  hashOf,
  keyFromScan,
  itemsOf,
  joinStamps,
  mergeEntries,
  newKey,
  open,
  parseKey,
  planRound,
  sameEntries,
  seal,
  stampLocal,
  stampsOf,
  TOMBSTONE_DAYS,
  type Entry,
  type SyncDoc,
} from '../src/core/sync';

const item = (id: string, name: string) => ({ id, name });

describe('sync key', () => {
  it('formats 32 bytes as 13 groups and reads them back however typed', () => {
    const key = newKey();
    expect(key).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    const bytes = parseKey(key)!;
    expect(formatKey(bytes)).toBe(key);
    expect(parseKey(key.toLowerCase().replaceAll('-', ' '))).toEqual(bytes);
    expect(parseKey(key.replaceAll('0', 'O').replaceAll('1', 'l'))).toEqual(bytes);
    expect(parseKey(key.slice(0, -1))).toBeNull();
    expect(parseKey(key.slice(0, -1) + 'U')).toBeNull();
  });

  it('derives the same id on every device and a different one for another key', async () => {
    const k = parseKey(newKey())!;
    const a = await deriveKeys(k);
    const b = await deriveKeys(new Uint8Array(k));
    expect(a.id).toMatch(/^[\w-]{43}$/);
    expect(b.id).toBe(a.id);
    expect((await deriveKeys(parseKey(newKey())!)).id).not.toBe(a.id);
  });

  it('seals and opens; the wrong key cannot open it', async () => {
    const { aes } = await deriveKeys(parseKey(newKey())!);
    const doc = { v: 1, tours: [{ id: 'a', at: 1, value: item('a', 'Zürich ↺') }], trips: [] };
    const data = await seal(doc, aes);
    expect(data).not.toContain('Zürich');
    expect(await open(data, aes)).toEqual(doc);
    const other = (await deriveKeys(parseKey(newKey())!)).aes;
    await expect(open(data, other)).rejects.toThrow();
  });

  it('seals a large copy (more than 500 KB after compression) without overflowing', async () => {
    const { aes } = await deriveKeys(parseKey(newKey())!);
    // Random text barely compresses: about 900 KB sealed.
    const noise = Array.from({ length: 10 }, () =>
      Array.from(crypto.getRandomValues(new Uint8Array(60_000)), (b) => b.toString(36)).join(''),
    ).join('');
    const doc = { v: 1, tours: [], trips: [{ id: 'a', at: 1, value: { noise } }] };
    const data = await seal(doc, aes);
    expect(data.length).toBeGreaterThan(500_000);
    expect(await open(data, aes)).toEqual(doc);
  });
});

describe('scanned codes', () => {
  it('reads the key from the app link or as a bare key, nothing else', () => {
    const key = newKey();
    expect(keyFromScan(`https://jibes.github.io/swiss-rail-routes/#/sync/${key}`)).toBe(key);
    expect(keyFromScan(`  ${key.toLowerCase()} `)).toBe(key);
    expect(keyFromScan('https://example.com/#/sync/nope')).toBeNull();
    expect(keyFromScan('WIFI:S:home;T:WPA;P:secret;;')).toBeNull();
  });
});

describe('merging', () => {
  it('stamps changes with now, keeps unchanged times, turns removals into tombstones', () => {
    const first = stampLocal({}, [item('a', 'A'), item('b', 'B')], 100);
    const prev = stampsOf(first);
    const next = stampLocal(prev, [item('a', 'A'), item('c', 'C')], 200);
    expect(next).toEqual([
      { id: 'a', at: 100, value: item('a', 'A') },
      { id: 'c', at: 200, value: item('c', 'C') },
      { id: 'b', at: 200 },
    ]);
    expect(stampLocal(prev, [item('a', 'A2'), item('b', 'B')], 300)[0]!.at).toBe(300);
  });

  it('the newer change wins per item, both ways', () => {
    const phone = [
      { id: 'a', at: 300, value: item('a', 'renamed on phone') },
      { id: 'b', at: 100, value: item('b', 'B') },
    ];
    const laptop = [
      { id: 'a', at: 200, value: item('a', 'A') },
      { id: 'b', at: 250 }, // deleted on the laptop later
      { id: 'c', at: 260, value: item('c', 'new on laptop') },
    ];
    const m = mergeEntries(phone, laptop, 400);
    expect(itemsOf(m, [item('a', ''), item('b', '')])).toEqual([
      item('c', 'new on laptop'),
      item('a', 'renamed on phone'),
    ]);
    expect(sameEntries(m, mergeEntries(laptop, phone, 400))).toBe(true);
  });

  it(`forgets tombstones after ${TOMBSTONE_DAYS} days`, () => {
    const day = 86_400_000;
    expect(mergeEntries([{ id: 'x', at: 0 }], [], TOMBSTONE_DAYS * day - 1)).toHaveLength(1);
    expect(mergeEntries([{ id: 'x', at: 0 }], [], TOMBSTONE_DAYS * day)).toHaveLength(0);
  });
});

describe('hashing', () => {
  it('ignores key order: a route rebuilt on loading is not a change', () => {
    expect(hashOf({ a: 1, b: [{ x: 1, y: 2 }] })).toBe(hashOf({ b: [{ y: 2, x: 1 }], a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    // Same item, keys reordered, stamped with an old (order-sensitive) hash: still unchanged.
    const before = [{ id: 'r', at: 100, value: { id: 'r', name: 'A', n: 1 } }];
    const reordered = [{ n: 1, name: 'A', id: 'r' }];
    expect(stampLocal(stampsOf(before), reordered, 500)[0]!.at).toBe(100);
  });
});

describe('planRound: one sync round', () => {
  type R = { id: string; name: string };
  const none = { tours: {}, trips: {} };
  const doc = (tours: Entry<R>[]): SyncDoc<R, R> => ({ v: 1, tours, trips: [] });
  const local = (tours: R[]) => ({ tours, trips: [] as R[] });
  const day = 86_400_000;

  it('uploads a deletion and an edit of something the other side already has', () => {
    const shared = [
      { id: 'a', at: 100, value: item('a', 'A') },
      { id: 'b', at: 100, value: item('b', 'B') },
    ];
    const stamps = { tours: stampsOf(shared), trips: {} };
    const plan = planRound({
      stamps,
      local: local([item('a', 'A, renamed')]),
      remote: doc(shared),
      now: 200,
    });
    expect(plan.push).toBe(true);
    expect(itemsOf(plan.merged.tours, [])).toEqual([item('a', 'A, renamed')]);
    expect(plan.merged.tours.find((e) => e.id === 'b')).toEqual({ id: 'b', at: 200 });
  });

  it('a timetable planned here is no change: a newer route edit elsewhere still wins', () => {
    const trip = (route: string, chain?: string) => ({
      id: 't',
      route: { stations: route },
      ...(chain ? { chain: { dep: chain } } : {}),
    });
    const shared = [{ id: 't', at: 100, value: trip('A-B') }];
    const stamps = { tours: {}, trips: stampsOf(shared) };
    // Here: planned the old route (chain added). There: the route changed at 150.
    const plan = planRound({
      stamps,
      local: { tours: [], trips: [trip('A-B', '08:00')] },
      remote: { v: 1, tours: [], trips: [{ id: 't', at: 150, value: trip('A-C') }] },
      now: 200,
    });
    expect(itemsOf(plan.merged.trips, [])).toEqual([trip('A-C')]);
    // And the same route planned here keeps this device's timetable.
    const same = planRound({
      stamps,
      local: { tours: [], trips: [trip('A-B', '08:00')] },
      remote: { v: 1, tours: [], trips: shared },
      now: 200,
    });
    expect(same.apply.trips).toBeUndefined();
    expect(same.push).toBe(false);
  });

  it('applies a deletion from the other side and pushes nothing back', () => {
    const before = [{ id: 'a', at: 100, value: item('a', 'A') }];
    const plan = planRound({
      stamps: { tours: stampsOf(before), trips: {} },
      local: local([item('a', 'A')]),
      remote: doc([{ id: 'a', at: 150 }]),
      now: 200,
    });
    expect(plan.apply.tours).toEqual([]);
    expect(plan.push).toBe(false);
  });

  it('changes nothing when both sides agree (no endless rounds)', () => {
    const shared = [
      { id: 'a', at: 100, value: item('a', 'A') },
      { id: 'x', at: 90 },
    ];
    const plan = planRound({
      stamps: { tours: stampsOf(shared), trips: {} },
      local: local([item('a', 'A')]),
      remote: doc(shared),
      now: 200,
    });
    expect(plan.apply).toEqual({});
    expect(plan.push).toBe(false);
  });

  it('joining: the shared copy wins over what the device had; its own items are added', () => {
    const mine = [item('a', 'old copy'), item('n', 'only here')];
    const plan = planRound({
      stamps: { tours: joinStamps(mine), trips: {} },
      local: local(mine),
      remote: doc([
        { id: 'a', at: 100, value: item('a', 'newer elsewhere') },
        { id: 'd', at: 120 },
      ]),
      now: 200,
    });
    expect(plan.apply.tours).toEqual([item('a', 'newer elsewhere'), item('n', 'only here')]);
    expect(plan.push).toBe(true);
  });

  it('an edit beats a newer stamp from a device whose clock runs ahead', () => {
    const ahead = [{ id: 'a', at: 5_000, value: item('a', 'A') }];
    const plan = planRound({
      stamps: { tours: stampsOf(ahead), trips: {} },
      local: local([item('a', 'edited here')]),
      remote: doc(ahead),
      now: 1_000,
    });
    expect(plan.merged.tours[0]).toEqual({ id: 'a', at: 5_001, value: item('a', 'edited here') });
  });

  it('after more than 90 days away, what the others deleted is not brought back', () => {
    const before = [{ id: 'old', at: 100, value: item('old', 'Old') }];
    const plan = planRound({
      stamps: { tours: stampsOf(before), trips: {} },
      local: local([item('old', 'Old'), item('new', 'made offline')]),
      remote: doc([]),
      now: 100 + 100 * day,
      lastSync: 100,
    });
    expect(itemsOf(plan.merged.tours, [])).toEqual([item('new', 'made offline')]);
  });

  it('first round with nothing shared yet uploads everything', () => {
    const plan = planRound({ stamps: none, local: local([item('a', 'A')]), remote: null, now: 1 });
    expect(plan.push).toBe(true);
    expect(plan.apply).toEqual({});
  });

  it('equal times pick the same winner on every device', () => {
    const x = { id: 'a', at: 7, value: item('a', 'X') };
    const y = { id: 'a', at: 7, value: item('a', 'Y') };
    expect(mergeEntries([x], [y], 8)).toEqual(mergeEntries([y], [x], 8));
  });
});
