// Timetable answers kept on the device: when they still stand for asking again, and the I/O
// around them (IndexedDB faked, the timetable service mocked).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optionsKey, SAME_DAY_MS, stillGood, toDrop } from '../src/core/answers';
import type { TripQuery } from '../src/core/ojp/request';
import { newTour } from './helpers/edit';

const at = (iso: string) => Date.parse(iso);
const kept = (day: string, when: string, size = 10) => ({ day, at: at(when), size });

describe('when a kept answer still stands', () => {
  const now = at('2026-11-05T10:00:00Z');
  it('before its day: until the day starts, however old', () => {
    expect(stillGood(kept('2026-11-07', '2026-11-01T08:00:00Z'), now)).toBe(true);
  });
  it('on its day: 15 minutes, as trains run late or are cancelled', () => {
    const today = '2026-11-05';
    expect(stillGood(kept(today, '2026-11-05T09:50:00Z'), now)).toBe(true);
    expect(stillGood(kept(today, '2026-11-05T09:44:00Z'), now)).toBe(false);
    // Asked the day before: the day has come, ask again.
    expect(stillGood(kept(today, '2026-11-04T23:00:00Z'), now)).toBe(false);
    expect(SAME_DAY_MS).toBe(15 * 60_000);
  });
  it('a past day never; a time ahead of the clock or nonsense never', () => {
    expect(stillGood(kept('2026-11-04', '2026-11-03T08:00:00Z'), now)).toBe(false);
    expect(stillGood(kept('2026-11-07', '2026-11-06T08:00:00Z'), now)).toBe(false);
    expect(stillGood({ day: 7, at: 0, size: 1 } as never, now)).toBe(false);
  });
  it('too many: the oldest go first', () => {
    const all: [string, ReturnType<typeof kept>][] = [
      ['old', kept('2026-11-07', '2026-11-01T08:00:00Z', 50)],
      ['new', kept('2026-11-07', '2026-11-04T08:00:00Z', 50)],
      ['gone', kept('2026-11-01', '2026-10-30T08:00:00Z', 1)],
    ];
    expect(toDrop(all, now, 80).sort()).toEqual(['gone', 'old']);
  });
  it('the options of a route do not depend on its name or the time asked from', () => {
    const t = newTour('a', '2026-11-07');
    expect(optionsKey({ ...t, name: 'other', anchor: { departAt: '11:00' } } as never)).toBe(
      optionsKey(t),
    );
    expect(optionsKey({ ...t, date: '2026-11-08' })).not.toBe(optionsKey(t));
    // Options kept before the choice existed stay valid under the default; another has its own.
    expect(optionsKey(t, 'avoid')).toBe(optionsKey(t));
    expect(optionsKey(t, 'never')).not.toBe(optionsKey(t));
  });
});

const q = (time: string): TripQuery => ({
  origin: { ref: 'a', name: 'A' },
  destination: { ref: 'b', name: 'B' },
  vias: [],
  notVias: [],
  time,
  arriveBy: false,
  results: 6,
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../src/io/ojp');
});

async function setup() {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const fetchTrips = vi.fn(async () => [] as never[]);
  vi.doMock('../src/io/ojp', async (orig) => ({
    ...(await orig<typeof import('../src/io/ojp')>()),
    fetchTrips,
  }));
  return { fetchTrips, ...(await import('../src/io/answers')) };
}

describe('asking the timetable with answers kept', () => {
  it('the same question before its day is answered from the device', async () => {
    vi.useFakeTimers({ now: at('2026-11-05T10:00:00Z'), toFake: ['Date'] });
    const { fetchTrips, cachedTrips } = await setup();
    await cachedTrips(q('2026-11-07T09:00'));
    await cachedTrips(q('2026-11-07T09:00'));
    expect(fetchTrips).toHaveBeenCalledTimes(1);
    // Another time is another question.
    await cachedTrips(q('2026-11-07T10:00'));
    expect(fetchTrips).toHaveBeenCalledTimes(2);
  });

  it('on the day, asked again after 15 minutes', async () => {
    vi.useFakeTimers({ now: at('2026-11-07T08:00:00Z'), toFake: ['Date'] });
    const { fetchTrips, cachedTrips } = await setup();
    await cachedTrips(q('2026-11-07T11:00'));
    vi.setSystemTime(at('2026-11-07T08:10:00Z'));
    await cachedTrips(q('2026-11-07T11:00'));
    expect(fetchTrips).toHaveBeenCalledTimes(1);
    vi.setSystemTime(at('2026-11-07T08:16:00Z'));
    await cachedTrips(q('2026-11-07T11:00'));
    expect(fetchTrips).toHaveBeenCalledTimes(2);
  });

  it('a failure is never kept', async () => {
    vi.useFakeTimers({ now: at('2026-11-05T10:00:00Z'), toFake: ['Date'] });
    const { fetchTrips, cachedTrips } = await setup();
    fetchTrips.mockRejectedValueOnce(new Error('offline'));
    await expect(cachedTrips(q('2026-11-07T09:00'))).rejects.toThrow('offline');
    await cachedTrips(q('2026-11-07T09:00'));
    expect(fetchTrips).toHaveBeenCalledTimes(2);
  });

  it('tidying drops answers about days gone', async () => {
    vi.useFakeTimers({ now: at('2026-11-05T10:00:00Z'), toFake: ['Date'] });
    const { fetchTrips, cachedTrips, tidyAnswers } = await setup();
    await cachedTrips(q('2026-11-07T09:00'));
    await tidyAnswers(at('2026-11-08T10:00:00Z'));
    await cachedTrips(q('2026-11-07T09:00'));
    expect(fetchTrips).toHaveBeenCalledTimes(2);
  });
});

describe('options loaded with the arrows', () => {
  it('kept per trip and route until they have left; trips gone are dropped', async () => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
    const { loadOptions, saveOptions } = await import('../src/io/tours');
    const opt = (dep: string) => ({ c: { dep, arr: dep } as never, legs: [] });
    const list = [opt('2026-11-07T08:00:00Z'), opt('2026-11-07T10:00:00Z')];
    const now = at('2026-11-05T10:00:00Z');
    await saveOptions('t', { key: 'k', list }, new Set(['t']), now);
    await saveOptions('gone', { key: 'k', list }, new Set(['t']), now);
    vi.useFakeTimers({ now: at('2026-11-07T09:00:00Z'), toFake: ['Date'] });
    expect((await loadOptions('t', 'k')).map((o) => o.c.dep)).toEqual(['2026-11-07T10:00:00Z']);
    expect(await loadOptions('t', 'other route')).toEqual([]);
    expect(await loadOptions('gone', 'k')).toEqual([]);
  });
});
