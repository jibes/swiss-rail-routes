// Saving lists, planning in the background, a plan shared by two screens: the I/O around the
// stores, with IndexedDB faked and the timetable mocked.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanResult } from '../src/core/planner/plan';
import { newTrip, type Trip } from '../src/core/trip';
import { newTour } from './helpers/edit';
import { ref } from './helpers/timetable';

const item = (id: string, n = 0) => ({ id, n });
const read = (raw: unknown) => (Array.isArray(raw) ? (raw as { id: string; n: number }[]) : []);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a saved list shared by tabs', () => {
  it('a stale tab saving its own change never drops what another tab saved', async () => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
    // No message between the tabs: the stale tab really is stale.
    vi.stubGlobal('BroadcastChannel', undefined);
    const { savedList } = await import('../src/io/listStore');
    const { get } = await import('idb-keyval');
    const a = savedList('k', read);
    const b = savedList('k', read);
    await a.save([], [item('x')], true);
    // Tab b still thinks the list is empty.
    await b.save([], [item('y')], true);
    expect(((await get('k')) as { id: string }[]).map((x) => x.id).sort()).toEqual(['x', 'y']);
  });

  it('a list that could not be read is never written; a failed write says so', async () => {
    vi.resetModules();
    const real = await vi.importActual<typeof import('idb-keyval')>('idb-keyval');
    const fail = { get: false, update: false };
    vi.doMock('idb-keyval', () => ({
      ...real,
      get: (k: IDBValidKey) => (fail.get ? Promise.reject(new Error('lost')) : real.get(k)),
      update: (k: IDBValidKey, f: (v: unknown) => unknown) =>
        fail.update ? Promise.reject(new Error('quota')) : real.update(k, f),
    }));
    globalThis.indexedDB = new IDBFactory();
    vi.stubGlobal('BroadcastChannel', undefined);
    const { savedList } = await import('../src/io/listStore');
    const list = savedList('k2', read);
    const told = vi.fn();
    list.onFailed(told);
    fail.get = true;
    await expect(list.load()).rejects.toThrow('lost');
    expect(list.failed()).toBe(true);
    expect(told).toHaveBeenCalledOnce();
    fail.get = false;
    await expect(list.save([], [item('z')], true)).rejects.toThrow();
    expect(await real.get('k2')).toBeUndefined();

    const other = savedList('k3', read);
    fail.update = true;
    await expect(other.save([], [item('q')], true)).rejects.toThrow('quota');
    expect(other.failed()).toBe(true);
    vi.doUnmock('idb-keyval');
  });
});

const tripOf = (id: string): Trip =>
  newTrip(
    id,
    {
      ...newTour(id, '2026-11-14'),
      waypoints: [
        { stopRef: ref('Zürich HB'), name: 'Zürich HB', kind: 'start', dwellMin: 0 },
        { stopRef: ref('Chur'), name: 'Chur', kind: 'end', dwellMin: 0 },
      ],
    },
    undefined,
    undefined,
    new Date(0),
  );

describe('planning in the background', () => {
  it('a trip with no connection is asked once, again only after ten minutes', async () => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
    vi.useFakeTimers({ now: Date.parse('2026-11-02T10:00:00Z') });
    const planRoute = vi.fn(async (): Promise<PlanResult> => ({ relaxed: [], failedLeg: 0 }));
    vi.doMock('../src/io/planTrip', async (orig) => ({
      ...(await orig<typeof import('../src/io/planTrip')>()),
      planRoute,
    }));
    const { useTrips } = await import('../src/trips');
    const { watchAutoPlan } = await import('../src/io/autoplan');
    useTrips.setState({ loaded: true, trips: [tripOf('t')] });
    const stop = watchAutoPlan();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(planRoute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(planRoute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(planRoute).toHaveBeenCalledTimes(2);
    // The route changed (here: the trip gone): its failure is forgotten, nothing wakes it.
    useTrips.setState({ trips: [] });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(planRoute).toHaveBeenCalledTimes(2);
    // Asleep: no timer left to wake it every few seconds.
    expect(vi.getTimerCount()).toBe(0);
    stop();
    vi.doUnmock('../src/io/planTrip');
  });

  it('one screen leaving does not stop the plan another one waits for', async () => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
    let answer: (v: []) => void = () => undefined;
    const seen: AbortSignal[] = [];
    vi.doMock('../src/io/ojp', async (orig) => ({
      ...(await orig<typeof import('../src/io/ojp')>()),
      fetchTrips: vi.fn((_q: unknown, signal?: AbortSignal) => {
        if (signal) seen.push(signal);
        return new Promise((r) => (answer = r));
      }),
    }));
    vi.doMock('../src/io/stops', async () => {
      const { index } = await import('./helpers/timetable');
      return { stopSearch: async () => index };
    });
    const { planRoute } = await import('../src/io/planTrip');
    const t = tripOf('shared');
    const leaving = new AbortController();
    const first = planRoute(t, leaving.signal, false);
    const second = planRoute(t, undefined, false);
    await vi.waitFor(() => expect(seen.length).toBe(1), { timeout: 5000 });
    leaving.abort();
    await expect(first).rejects.toBeDefined();
    expect(seen[0]!.aborted).toBe(false);
    answer([]);
    await expect(second).resolves.toMatchObject({ failedLeg: 0 });
    vi.doUnmock('../src/io/ojp');
    vi.doUnmock('../src/io/stops');
  });
});
