import { describe, expect, it } from 'vitest';
import type { Leg, Tour, Waypoint } from '../src/core/model';
import type { PlannedChain } from '../src/core/planner/plan';
import { nightsOf, onwardFrom, splitAllNights, splitNights } from '../src/core/nights';
import { newTrip, type Trip } from '../src/core/trip';

const w = (name: string, x: Partial<Waypoint> = {}): Waypoint => ({
  stopRef: `ch:1:sloid:${name}`,
  name,
  kind: 'via',
  dwellMin: 0,
  ...x,
});
const tour = (waypoints: Waypoint[], date = '2026-12-27'): Tour => ({
  id: 'r',
  name: 'Up north',
  date,
  anchor: { departAt: '13:00' },
  ticket: 'GA',
  travelClass: 2,
  waypoints,
  schema: 1,
});
const trip = (route: Tour, legs?: Leg[], chain?: PlannedChain): Trip => ({
  ...newTrip('t', route, legs, chain, new Date(0)),
  name: 'Up north',
});
// Boden → Umeå (a night) → Stockholm (a night) → Göteborg, as entered in the log of 10 Nov 2026.
const sweden = [
  w('Boden', { kind: 'start' }),
  w('Umeå', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-28T08:00' }),
  w('Stockholm', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-29T08:00', line: 'x' }),
  w('Göteborg', { kind: 'end' }),
];

describe('one trip per day of travel (0.64.0)', () => {
  it('splits at each night, the next days from where the stays ended', () => {
    const parts = splitNights(trip(tour(sweden)));
    expect(parts.map((p) => p.id)).toEqual(['t', 't-2', 't-3']);
    expect(parts.map((p) => p.route.waypoints.map((x) => x.name))).toEqual([
      ['Boden', 'Umeå'],
      ['Umeå', 'Stockholm'],
      ['Stockholm', 'Göteborg'],
    ]);
    expect(parts.map((p) => [p.route.date, p.route.anchor])).toEqual([
      ['2026-12-27', { departAt: '13:00' }],
      ['2026-12-28', { departAt: '08:00' }],
      ['2026-12-29', { departAt: '08:00' }],
    ]);
    // Each ends and starts without the night: no stay, the line into it kept by the day before.
    const [a, b, c] = parts;
    expect(a!.route.waypoints[1]).toMatchObject({ kind: 'end', dwellMin: 0 });
    expect(a!.route.waypoints[1]!.stayUntil).toBeUndefined();
    expect(b!.route.waypoints[1]).toMatchObject({ kind: 'end', line: 'x' });
    expect(c!.route.waypoints[0]).toMatchObject({ kind: 'start', dwellMin: 0 });
    expect(c!.route.waypoints[0]!.line).toBeUndefined();
    expect(parts.map((p) => p.name)).toEqual(['Up north', '', '']);
    expect(parts.every((p) => !p.chain)).toBe(true);
  });

  it('a stay that day, or one given as a length, is no night', () => {
    const day = [
      w('Boden', { kind: 'start' }),
      w('Umeå', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-27T20:00' }),
      w('Luleå', { kind: 'stop', dwellMin: 600 }),
      w('Kiruna', { kind: 'end' }),
    ];
    const t = trip(tour(day));
    expect(splitNights(t)).toEqual([t]);
    expect(splitAllNights([t])).toEqual([t]);
  });

  it('a night train is a ride: a stay the morning it arrives is the same trip', () => {
    // Boden 22:18 → Stockholm 09:28 next day, a stay until 12:00 there, then on.
    const ws = [
      w('Boden', { kind: 'start' }),
      w('Stockholm', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-28T12:00' }),
      w('Göteborg', { kind: 'end' }),
    ];
    const legs: Leg[] = [
      { index: 0, from: ws[0]!, to: ws[1]!, vias: [] },
      { index: 1, from: ws[1]!, to: ws[2]!, vias: [] },
    ];
    const conn = (arr: string) =>
      ({ arr, sections: [] }) as unknown as PlannedChain['connections'][number];
    const chain = {
      connections: [conn('2026-12-28T08:28:00Z'), conn('2026-12-28T14:30:00Z')],
      warnings: [],
      score: 0,
      dep: '2026-12-27T21:18:00Z',
      arr: '2026-12-28T14:30:00Z',
    } as PlannedChain;
    expect(nightsOf(trip(tour(ws), legs, chain))).toEqual([]);
    // Unplanned, the day is not known: a night is assumed there (a station sooner, still one).
    expect(nightsOf(trip(tour(ws)))).toHaveLength(1);
  });

  it('a part synced in as well as made here comes once', () => {
    const t = trip(tour(sweden));
    const [, second] = splitNights(t);
    const list = splitAllNights([t, { ...second!, name: 'theirs' }]);
    expect(list.map((x) => x.id)).toEqual(['t', 't-2', 't-3']);
  });

  it('a new trip may start where the last one ahead ends, the day after', () => {
    const t = trip(tour([w('Boden', { kind: 'start' }), w('Umeå', { kind: 'end' })]));
    const now = Date.parse('2026-12-01T10:00:00Z');
    expect(onwardFrom([t], now, 'new')).toEqual({
      stopRef: 'ch:1:sloid:Umeå',
      name: 'Umeå',
      date: '2026-12-28',
      from: 'Boden',
    });
    // Not from itself, and not from a trip over.
    expect(onwardFrom([t], now, 't')).toBeUndefined();
    expect(onwardFrom([t], Date.parse('2027-01-10T10:00:00Z'), 'new')).toBeUndefined();
  });
});
