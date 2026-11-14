import { describe, expect, it } from 'vitest';
import { shiftUntil, stayEnd, stayLength, untilAt } from '../src/core/stay';
import { staysOfOld } from '../src/core/stay';

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

  it('a time typed is on the arrival day; none before the arrival (a stay ends its day)', () => {
    expect(untilAt('16:30', ARR, '2026-11-12')).toBe('2026-11-12T16:30');
    // 0.64.0: no wrap past midnight; a night is the end of the trip.
    expect(untilAt('01:00', ARR, '2026-11-12')).toBeNull();
    // Unplanned: on the trip's day.
    expect(untilAt('09:15', undefined, '2026-11-12')).toBe('2026-11-12T09:15');
  });

  it('moves across midnight and the clock change', () => {
    expect(shiftUntil('2026-11-12T23:50', 15)).toBe('2026-11-13T00:05');
    expect(shiftUntil('2026-10-25T01:45', 60)).toBe('2026-10-25T02:45');
  });
});

describe('a time to leave by from before 0.67.0', () => {
  it('stored trips read it as a stay until then; come after dropped; none, the same list', () => {
    const route = {
      date: '2026-11-12',
      waypoints: [
        { stopRef: 'a', name: 'A', kind: 'start' as const, dwellMin: 0 },
        {
          stopRef: 'b',
          name: 'B',
          kind: 'stop' as const,
          dwellMin: 60,
          leaveBy: '17:30',
          arriveAfter: '10:00',
        },
        { stopRef: 'c', name: 'C', kind: 'end' as const, dwellMin: 0 },
      ],
    };
    const [t] = staysOfOld([{ id: 't', route }]);
    expect(t!.route.waypoints[1]).toEqual({
      stopRef: 'b',
      name: 'B',
      kind: 'stop',
      dwellMin: 60,
      stayUntil: '2026-11-12T17:30',
    });
    const plain = [
      { id: 'u', route: { ...route, waypoints: [route.waypoints[0]!, route.waypoints[2]!] } },
    ];
    expect(staysOfOld(plain)).toBe(plain);
  });
});
