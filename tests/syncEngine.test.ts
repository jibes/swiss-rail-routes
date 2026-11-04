// The sync engine (src/io/sync.ts) end to end: two devices, the Worker's own sync handler with
// an in-memory store, IndexedDB faked. Each device is a fresh module graph (its own stores).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { newTour } from './helpers/edit';
import { newTrip } from '../src/core/trip';
import { syncHandle, type SyncRecord } from '../workers/ojp/src/sync';

const WORKER = 'https://w.test';
const boxes = new Map<string, SyncRecord>();
const reset = () => boxes.clear();
/** The next PUTs fail with this status (the Worker or the network having a bad moment). */
let failPuts = 0;

/** While set, reads wait for it (the server slow to answer). */
let holdReads: Promise<void> | null = null;

const worker = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  const id = new URL(req.url).pathname.split('/')[2]!;
  if (req.method === 'GET' && holdReads) await holdReads;
  if (req.method === 'PUT' && failPuts > 0) {
    failPuts--;
    return new Response('busy', { status: 503 });
  }
  return syncHandle(req, {
    get: async () => boxes.get(id),
    put: async (r) => void boxes.set(id, r),
  });
};

let devices = 0;

/**
 * One device: its own IndexedDB and stores, sync loaded. idb-keyval is a dependency, so
 * `resetModules` leaves it as it is, and its default store would stay bound to the first
 * device's database: each device gets the library with a store of its own instead.
 */
async function device(stored?: Record<string, unknown>) {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const name = `device-${devices++}`;
  vi.doMock('idb-keyval', async () => {
    const actual = await vi.importActual<typeof import('idb-keyval')>('idb-keyval');
    const own = actual.createStore(name, 'keyval');
    const bound =
      <A extends unknown[], R>(f: (...a: [...A, typeof own]) => R) =>
      (...a: A) =>
        f(...a, own);
    return {
      ...actual,
      get: bound(actual.get),
      set: bound(actual.set),
      update: bound(actual.update),
      del: bound(actual.del),
      entries: bound(actual.entries),
      keys: bound(actual.keys),
      delMany: bound(actual.delMany),
    };
  });
  if (stored) {
    const { set } = await import('idb-keyval');
    for (const [k, v] of Object.entries(stored)) await set(k, v);
  }
  vi.stubEnv('VITE_OJP_URL', WORKER);
  vi.stubGlobal('fetch', worker);
  const sync = await import('../src/io/sync');
  const { useTrips } = await import('../src/trips');
  const { useTours } = await import('../src/tours');
  await Promise.all([useTrips.getState().load(), useTours.getState().load()]);
  await sync.loadSync();
  const { tripsList } = await import('../src/io/trips');
  const { get } = await import('idb-keyval');
  return { sync, useTrips, tripsList, get };
}

const trip = (id: string, name: string) =>
  newTrip(id, { ...newTour(id, '2026-11-07'), name }, undefined, undefined, new Date(0));

describe('sync engine', () => {
  it('a failed upload is not "synced": the change goes up on the next round', async () => {
    reset();
    const a = await device();
    await a.sync.startSync();
    const key = a.sync.useSync.getState().key!;
    expect(a.sync.useSync.getState().status).toBe('ok');

    // A first trip goes up: the box now has a version, so later rounds ask "changed since?".
    a.useTrips.getState().add(trip('t0', 'Albula'));
    await a.sync.syncNow();
    expect(a.sync.useSync.getState().status).toBe('ok');
    a.useTrips.getState().add(trip('t1', 'Rigi'));
    failPuts = 1;
    await a.sync.syncNow();
    expect(a.sync.useSync.getState().status).toBe('error');
    const before = [...boxes.values()][0]!.v;
    // A round by itself waits (backing off: each one would download the whole copy)…
    const gets = vi.fn();
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      gets();
      return worker(input, init);
    });
    await a.sync.syncNow();
    expect(gets).not.toHaveBeenCalled();
    expect([...boxes.values()][0]!.v).toBe(before);
    expect(a.sync.backoffMs(1)).toBe(60_000);
    expect(a.sync.backoffMs(9)).toBe(30 * 60_000);
    // …a tap on Sync now does not: the copy is read in full and the trip written after all.
    await a.sync.syncNow(true);
    expect(a.sync.useSync.getState().status).toBe('ok');
    const box = [...boxes.values()][0]!;
    expect(box.v).toBe(before + 1);
    // And it holds the trip: opened with the key, as another device would.
    const { deriveKeys, open, parseKey } = await import('../src/core/sync');
    const { aes } = await deriveKeys(parseKey(key)!);
    const doc = await open<{ trips: { id: string; value?: { name: string } }[] }>(box.data, aes);
    expect(doc.trips.flatMap((x) => (x.value ? [x.value.name] : [])).sort()).toEqual([
      'Albula',
      'Rigi',
    ]);
  });

  it('turning sync off while a round runs keeps it off', async () => {
    const a = await device();
    await a.sync.startSync();
    a.useTrips.getState().add(trip('t2', 'Albula'));
    const round = a.sync.syncNow();
    await a.sync.stopSync();
    await round;
    expect(a.sync.useSync.getState().key).toBeNull();
    await a.sync.loadSync();
    expect(a.sync.useSync.getState().key).toBeNull();
  });

  it('turned off while the server was asked: the shared copy is not taken in', async () => {
    reset();
    const a = await device();
    await a.sync.startSync();
    const key = a.sync.useSync.getState().key!;
    a.useTrips.getState().add(trip('ta', 'Albula'));
    await a.sync.syncNow();
    // Another device, same key: it took ta away and put tb in. This device turns sync off
    // while its round waits for the server.
    const { deriveKeys, parseKey, seal } = await import('../src/core/sync');
    const { id, aes } = await deriveKeys(parseKey(key)!);
    const cur = boxes.get(id)!;
    const later = Date.now() + 60_000;
    const data = await seal(
      {
        v: 1,
        tours: [],
        trips: [
          { id: 'ta', at: later },
          { id: 'tb', at: later, value: trip('tb', 'Rigi') },
        ],
      },
      aes,
    );
    boxes.set(id, { v: cur.v + 1, data });
    let release = () => {};
    holdReads = new Promise<void>((r) => (release = r));
    const round = a.sync.syncNow();
    await a.sync.stopSync();
    release();
    holdReads = null;
    await round;
    // Off, and the trips as they were on this device: not the other's.
    expect(a.sync.useSync.getState().key).toBeNull();
    expect(a.useTrips.getState().trips.map((t) => t.id)).toEqual(['ta']);
  });

  const openBox = async (key: string) => {
    const { deriveKeys, open, parseKey } = await import('../src/core/sync');
    const { id, aes } = await deriveKeys(parseKey(key)!);
    const box = boxes.get(id)!;
    return {
      id,
      box,
      doc: () => open<{ trips: { id: string; at: number; value?: unknown }[] }>(box.data, aes),
    };
  };

  it('a replaced key is an answer: retiring may run, it does not wait for good', async () => {
    reset();
    const a = await device();
    await a.sync.startSync();
    const key = a.sync.useSync.getState().key!;
    const { id } = await openBox(key);
    // Another device made a new key: this box is closed.
    await worker(`${WORKER}/sync/${id}`, { method: 'DELETE' });
    a.sync.useSync.setState({ settled: false });
    await a.sync.syncNow();
    expect(a.sync.useSync.getState().status).toBe('replaced');
    expect(a.sync.useSync.getState().settled).toBe(true);
  });

  it('a copy from a newer version of the app is left alone: "update the app"', async () => {
    reset();
    const a = await device();
    await a.sync.startSync();
    const key = a.sync.useSync.getState().key!;
    const { deriveKeys, parseKey, seal } = await import('../src/core/sync');
    const { id, aes } = await deriveKeys(parseKey(key)!);
    const newer = await seal({ v: 2, tours: [], trips: [], more: 'unknown to 0.7' }, aes);
    boxes.set(id, { v: 9, data: newer });
    await a.sync.syncNow();
    expect(a.sync.useSync.getState().status).toBe('update');
    expect(boxes.get(id)!.data).toBe(newer);
  });

  it('a new key carries the deletions and change times along', async () => {
    reset();
    const a = await device();
    await a.sync.startSync();
    a.useTrips.getState().add(trip('keep', 'Albula'));
    a.useTrips.getState().add(trip('gone', 'Rigi'));
    await a.sync.syncNow();
    a.useTrips.getState().remove('gone');
    await a.sync.syncNow();
    expect(await a.sync.renewKey()).toBe(true);
    const { doc } = await openBox(a.sync.useSync.getState().key!);
    const trips = (await doc()).trips;
    // The deletion goes along (else an older device joining would bring the trip back).
    const gone = trips.find((x) => x.id === 'gone');
    expect(gone).toBeDefined();
    expect(gone!.value).toBeUndefined();
    expect(trips.find((x) => x.id === 'keep')!.at).toBeGreaterThan(0);
  });
});

describe('the sync lock', () => {
  it('a lock another tab never lets go of does not hold this one for good', async () => {
    reset();
    const a = await device();
    await a.sync.startSync();
    vi.useFakeTimers();
    const request = vi.fn(
      (_name: string, opts: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          opts.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    vi.stubGlobal('navigator', { ...globalThis.navigator, locks: { request } });
    const round = a.sync.syncNow();
    await vi.advanceTimersByTimeAsync(a.sync.LOCK_WAIT_MS + 1);
    await expect(round).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(a.sync.useSync.getState().status).toBe('ok');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('a trip this version cannot read is held: shared on, kept, never deleted', async () => {
    reset();
    const future = { id: 'f', journey: { v: 2, legs: ['Chur', 'Arosa'] } };
    const a = await device({ 'srr.trips.v1': [trip('t0', 'Albula'), future] });
    expect(a.useTrips.getState().trips.map((t) => t.id)).toEqual(['t0']);
    await a.sync.startSync();
    const key = a.sync.useSync.getState().key!;
    a.useTrips.getState().add(trip('t1', 'Rigi'));
    await a.sync.syncNow();
    expect(a.sync.useSync.getState().status).toBe('ok');
    const stored = (await a.get('srr.trips.v1')) as { id: string }[];
    expect(
      stored.find((x) => x.id === 'f'),
      'still stored, as it came',
    ).toEqual(future);

    // Another device gets it too, held as it came, and shows only what it can read.
    const b = await device();
    await b.sync.startSync(key);
    expect(b.sync.useSync.getState().status).toBe('ok');
    expect(
      b.useTrips
        .getState()
        .trips.map((t) => t.id)
        .sort(),
    ).toEqual(['t0', 't1']);
    expect(b.tripsList.held()).toEqual([future]);
    // And back on the first one, after another round, it is no tombstone.
    await a.sync.syncNow();
    expect(((await a.get('srr.trips.v1')) as { id: string }[]).map((x) => x.id)).toContain('f');
    const saved = (await a.get('srr.sync.v1')) as {
      stamps: { trips: Record<string, { h: string }> };
    };
    expect(saved.stamps.trips.f!.h, 'not a deletion').not.toBe('');
  });
});
