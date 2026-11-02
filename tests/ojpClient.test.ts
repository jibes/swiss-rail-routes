// The app's trip requests: a busy Worker that asks for a minute is not asked again and again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TripQuery } from '../src/core/ojp/request';

const q: TripQuery = {
  origin: { ref: 'a', name: 'A' },
  destination: { ref: 'b', name: 'B' },
  vias: [],
  notVias: [],
  time: '2026-11-07T09:00',
  arriveBy: false,
  results: 6,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('a busy Worker', () => {
  it('asks to wait a minute: said at once, no retries for nothing', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_OJP_URL', 'https://w.test');
    const fetch = vi.fn(
      async () => new Response('rate', { status: 429, headers: { 'Retry-After': '60' } }),
    );
    vi.stubGlobal('fetch', fetch);
    const { fetchTrips, WorkerError } = await import('../src/io/ojp');
    await expect(fetchTrips(q)).rejects.toBeInstanceOf(WorkerError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks to wait a moment: waits and tries again', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_OJP_URL', 'https://w.test');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('<OJP/>', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { fetchTrips } = await import('../src/io/ojp');
    // The answer here is no trip answer: only that it was asked again counts.
    const p = fetchTrips(q).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
