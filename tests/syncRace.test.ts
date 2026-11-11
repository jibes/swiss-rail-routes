/* eslint-disable @typescript-eslint/no-explicit-any -- a mock of idb-keyval passing its arguments through */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { newTour } from './helpers/edit';
import { newTrip } from '../src/core/trip';
import { syncHandle, type SyncRecord } from '../workers/ojp/src/sync';
const boxes = new Map<string, SyncRecord>();
const worker = async (input: any, init?: RequestInit) => {
  const req = new Request(input, init);
  const id = new URL(req.url).pathname.split('/')[2]!;
  return syncHandle(req, {
    get: async () => boxes.get(id),
    put: async (r) => void boxes.set(id, r),
  });
};
const hook: { fn?: () => void; skip: number } = { skip: 0 };
let n = 0;
async function device() {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const name = `dev-${n++}`;
  vi.doMock('idb-keyval', async () => {
    const actual = await vi.importActual<typeof import('idb-keyval')>('idb-keyval');
    const own = actual.createStore(name, 'keyval');
    const b =
      (f: any) =>
      (...a: any[]) =>
        f(...a, own);
    const get = async (k: string) => {
      const v = await actual.get(k, own);
      if (k === 'srr.sync.v1' && hook.fn && hook.skip-- <= 0) {
        const f = hook.fn;
        hook.fn = undefined;
        f();
      }
      return v;
    };
    return {
      ...actual,
      get,
      set: b(actual.set),
      update: b(actual.update),
      del: b(actual.del),
      entries: b(actual.entries),
      keys: b(actual.keys),
      delMany: b(actual.delMany),
    };
  });
  vi.stubEnv('VITE_OJP_URL', 'https://w.test');
  vi.stubGlobal('fetch', worker);
  const sync = await import('../src/io/sync');
  const { useTrips } = await import('../src/trips');
  const { useTours } = await import('../src/tours');
  await Promise.all([useTrips.getState().load(), useTours.getState().load()]);
  await sync.loadSync();
  return { sync, useTrips };
}
const trip = (id: string, name: string) =>
  newTrip(id, { ...newTour(id, '2026-11-20'), name }, undefined, undefined, new Date(0));
// Third audit, 11 Nov 2026: a trip added while a round asked the server was deleted when the
// round applied what came in.
it('a trip added while a round runs is kept', async () => {
  const a = await device();
  await a.sync.startSync();
  const key = a.sync.useSync.getState().key!;
  const b = await device();
  await b.sync.startSync(key);
  b.useTrips.getState().add(trip('fromB', 'B'));
  await b.sync.syncNow();
  // back to A: hook adds a trip mid round
  // (a's modules are gone from registry but objects still live)
  let added = false;
  hook.skip = 1;
  hook.fn = () => {
    a.useTrips.getState().add(trip('mine', 'Mine'));
    added = true;
  };
  vi.stubGlobal('fetch', worker);
  await a.sync.syncNow(true);
  expect(added).toBe(true);
  expect(a.useTrips.getState().trips.map((t) => t.id)).toEqual(
    expect.arrayContaining(['mine', 'fromB']),
  );
});
