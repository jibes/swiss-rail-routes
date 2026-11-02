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

const worker = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  const id = new URL(req.url).pathname.split('/')[2]!;
  if (req.method === 'PUT' && failPuts > 0) {
    failPuts--;
    return new Response('busy', { status: 503 });
  }
  return syncHandle(req, {
    get: async () => boxes.get(id),
    put: async (r) => void boxes.set(id, r),
  });
};

/** One device: its own IndexedDB and stores, sync loaded. */
async function device() {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  vi.stubEnv('VITE_OJP_URL', WORKER);
  vi.stubGlobal('fetch', worker);
  const sync = await import('../src/io/sync');
  const { useTrips } = await import('../src/trips');
  const { useTours } = await import('../src/tours');
  await Promise.all([useTrips.getState().load(), useTours.getState().load()]);
  await sync.loadSync();
  return { sync, useTrips };
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
