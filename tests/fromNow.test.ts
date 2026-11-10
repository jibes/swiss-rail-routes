// Today, the planner never plans from a time already gone: a connection that has left is none to
// take, and choosing it would end the trip at once.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { fromNow } from '../src/io/planTrip';
import { newTour } from './helpers/edit';

const at = (iso: string) => Date.parse(iso);

describe('planning from now', () => {
  const tour = { ...newTour('t', '2026-11-07'), anchor: { departAt: '08:00' } };
  it('today, a time gone plans from now (Zurich time)', () => {
    expect(fromNow(tour, at('2026-11-07T13:10:00Z')).anchor).toEqual({ departAt: '14:10' });
  });
  it('a time ahead, another day or an arrival time stay as they are', () => {
    expect(fromNow(tour, at('2026-11-07T06:00:00Z'))).toBe(tour);
    expect(fromNow(tour, at('2026-11-06T13:10:00Z'))).toBe(tour);
    const by = { ...tour, anchor: { arriveBy: '09:00' } };
    expect(fromNow(by, at('2026-11-07T13:10:00Z'))).toBe(by);
  });
  it('a time gone that you set after it had gone stays: a trip already under way (0.49.0)', () => {
    // Set at 13:00 (Zurich 14:00) to 08:00: put in from when it left.
    expect(fromNow(tour, at('2026-11-07T13:10:00Z'), '2026-11-07T13:00:00Z')).toBe(tour);
    // Set at 06:30 (Zurich 07:30) for 08:00, planned only later: from now, as before.
    expect(fromNow(tour, at('2026-11-07T13:10:00Z'), '2026-11-07T06:30:00Z').anchor).toEqual({
      departAt: '14:10',
    });
  });
});
