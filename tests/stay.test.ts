import { describe, expect, it } from 'vitest';
import { shiftUntil, stayEnd, stayLength, untilAt } from '../src/core/stay';

// 14:00 in Zurich (CET, UTC+1).
const ARR = '2026-11-12T13:00:00Z';

describe('a stay said as length and end (0.51.0)', () => {
  it('fills each from the other by the arrival', () => {
    expect(stayEnd(ARR, 90, undefined)).toBe('2026-11-12T15:30');
    expect(stayLength(ARR, 1, '2026-11-12T16:30')).toBe(150);
    // The one kept wins: a time stays that time.
    expect(stayEnd(ARR, 90, '2026-11-12T16:30')).toBe('2026-11-12T16:30');
    expect(stayLength(ARR, 90, undefined)).toBe(90);
  });

  it('before a plan: the length as kept, no end', () => {
    expect(stayEnd(undefined, 30, undefined)).toBeUndefined();
    expect(stayLength(undefined, 30, '2026-11-12T16:30')).toBeUndefined();
    expect(stayLength(undefined, 30, undefined)).toBe(30);
  });

  it('a time typed is on the arrival day, the day after when before the arrival', () => {
    expect(untilAt('16:30', ARR, '2026-11-12', undefined)).toBe('2026-11-12T16:30');
    expect(untilAt('01:00', ARR, '2026-11-12', undefined)).toBe('2026-11-13T01:00');
    // Wrapped past midnight, then a time the same evening: that evening (not 25 h).
    expect(untilAt('23:00', ARR, '2026-11-12', '2026-11-13T01:00')).toBe('2026-11-12T23:00');
    // The next day chosen on the date pill (a time after the arrival's) is kept.
    expect(untilAt('15:00', ARR, '2026-11-12', '2026-11-13T16:00')).toBe('2026-11-13T15:00');
    // A day chosen later keeps its day.
    expect(untilAt('09:15', ARR, '2026-11-12', '2026-11-14T08:00')).toBe('2026-11-14T09:15');
    // Unplanned: on the trip's day.
    expect(untilAt('09:15', undefined, '2026-11-12', undefined)).toBe('2026-11-12T09:15');
  });

  it('moves across midnight and the clock change', () => {
    expect(shiftUntil('2026-11-12T23:50', 15)).toBe('2026-11-13T00:05');
    expect(shiftUntil('2026-10-25T01:45', 60)).toBe('2026-10-25T02:45');
  });
});
