// Planning in the background backs off: a route with no connection today is not asked about
// every ten minutes all day.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanResult } from '../src/core/planner/plan';
import { newTrip, type Trip } from '../src/core/trip';
import { newTour } from './helpers/edit';
import { ref } from './helpers/timetable';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock('../src/io/planTrip');
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

describe('autoplan back-off', () => {
  it('waits 10, 20, 40 minutes… after failures in a row; online again asks at once', async () => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
    vi.useFakeTimers({ now: Date.parse('2026-11-02T06:00:00Z') });
    const planRoute = vi.fn(async (): Promise<PlanResult> => ({ relaxed: [], failedLeg: 0 }));
    vi.doMock('../src/io/planTrip', async (orig) => ({
      ...(await orig<typeof import('../src/io/planTrip')>()),
      planRoute,
    }));
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    const { useTrips } = await import('../src/trips');
    const { watchAutoPlan, retryAfterMs, RETRY_MAX_MS } = await import('../src/io/autoplan');
    useTrips.setState({ loaded: true, trips: [tripOf('t')] });
    const stop = watchAutoPlan();
    const min = 60_000;
    await vi.advanceTimersByTimeAsync(min);
    expect(planRoute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * min);
    expect(planRoute).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15 * min);
    expect(planRoute).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6 * min);
    expect(planRoute).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(35 * min);
    expect(planRoute).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(6 * min);
    expect(planRoute).toHaveBeenCalledTimes(4);
    expect(retryAfterMs(1)).toBe(10 * min);
    expect(retryAfterMs(6)).toBe(RETRY_MAX_MS);
    expect(retryAfterMs(20)).toBe(RETRY_MAX_MS);
    // Back online: the wait is forgotten.
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(min);
    expect(planRoute).toHaveBeenCalledTimes(5);
    stop();
  });
});
