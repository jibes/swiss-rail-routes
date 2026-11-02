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
    // Next round: the copy on the Worker is read in full and the trip written after all.
    await a.sync.syncNow();
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
});
