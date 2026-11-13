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
type Conn = PlannedChain['connections'][number];
/** A planned trip: one leg between each two stopping stations, with its times (UTC). */
const planned = (ws: Waypoint[], times: [string, string][], route = tour(ws)): Trip => {
  const stops = ws.filter((x) => x.kind !== 'via');
  const legs: Leg[] = times.map((_, i) => ({
    index: i,
    from: stops[i]!,
    to: stops[i + 1]!,
    vias: [],
  }));
  const connections = times.map(
    ([dep, arr], i) => ({ legIndex: i, dep, arr, transfers: 0, sections: [] }) as unknown as Conn,
  );
  const chain: PlannedChain = {
    connections,
    warnings: times.map((_, i) => ({
      type: 'notice',
      severity: 'info',
      legIndex: i,
      key: `w${i}`,
      params: {},
    })),
    score: 0,
    dep: times[0]![0],
    arr: times.at(-1)![1],
  } as unknown as PlannedChain;
  return { ...newTrip('t', route, legs, chain, new Date(0)), name: 'Up north' };
};
const BEFORE = Date.parse('2026-12-01T10:00:00Z');
// Boden → Umeå (a night) → Stockholm (a night) → Göteborg, as entered in the log of 10 Nov 2026.
const sweden = [
  w('Boden', { kind: 'start' }),
  w('Umeå', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-28T08:00' }),
  w('Stockholm', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-29T08:00', line: 'x' }),
  w('Göteborg', { kind: 'end' }),
];
const swedenTimes: [string, string][] = [
  ['2026-12-27T12:00:00Z', '2026-12-27T16:00:00Z'],
  ['2026-12-28T07:10:00Z', '2026-12-28T13:00:00Z'],
  ['2026-12-29T07:10:00Z', '2026-12-29T10:20:00Z'],
];

describe('one trip per day of travel (0.64.0)', () => {
  it('splits a planned trip at each night, each part with its own timetable (0.64.3)', () => {
    const parts = splitNights(planned(sweden, swedenTimes), BEFORE);
    expect(parts.map((p) => p.id)).toEqual(['t', 't-2', 't-3']);
    expect(parts.map((p) => p.route.waypoints.map((x) => x.name))).toEqual([
      ['Boden', 'Umeå'],
      ['Umeå', 'Stockholm'],
      ['Stockholm', 'Göteborg'],
    ]);
    // Each leaves at its first train (Zurich time), on its day.
    expect(parts.map((p) => [p.route.date, p.route.anchor])).toEqual([
      ['2026-12-27', { departAt: '13:00' }],
      ['2026-12-28', { departAt: '08:10' }],
      ['2026-12-29', { departAt: '08:10' }],
    ]);
    // Its own legs, connections and warnings, numbered from 0: nothing to plan again.
    for (const [i, p] of parts.entries()) {
      expect(p.legs).toHaveLength(1);
      expect(p.chain!.connections.map((c) => [c.legIndex, c.dep])).toEqual([
        [0, swedenTimes[i]![0]],
      ]);
      expect(p.chain!.warnings.map((x) => [x.legIndex, x.key])).toEqual([[0, `w${i}`]]);
      expect([p.chain!.dep, p.chain!.arr]).toEqual(swedenTimes[i]);
      expect(p.legs![0]!.from).toBe(p.route.waypoints[0]);
      expect(p.legs![0]!.to).toBe(p.route.waypoints.at(-1));
    }
    const [a, b, c] = parts;
    expect(a!.route.waypoints[1]).toMatchObject({ kind: 'end', dwellMin: 0 });
    expect(a!.route.waypoints[1]!.stayUntil).toBeUndefined();
    expect(b!.route.waypoints[1]).toMatchObject({ kind: 'end', line: 'x' });
    expect(c!.route.waypoints[0]).toMatchObject({ kind: 'start', dwellMin: 0 });
    expect(c!.route.waypoints[0]!.line).toBeUndefined();
    expect(parts.map((p) => p.name)).toEqual(['Up north', '', '']);
  });

  it('an arrive-by is the last day’s', () => {
    const t = planned(sweden, swedenTimes, { ...tour(sweden), anchor: { arriveBy: '12:00' } });
    const parts = splitNights(t, BEFORE);
    expect(parts.map((p) => p.route.anchor)).toEqual([
      { departAt: '13:00' },
      { departAt: '08:10' },
      { arriveBy: '12:00' },
    ]);
  });

  it('not split: unplanned, begun or over (nothing of its timetable is lost)', () => {
    const t = planned(sweden, swedenTimes);
    expect(splitNights({ ...t, chain: undefined, legs: undefined }, BEFORE)).toHaveLength(1);
    expect(splitNights(t, Date.parse('2026-12-27T12:30:00Z'))).toEqual([t]);
    expect(splitNights(t, Date.parse('2027-01-10T12:00:00Z'))).toEqual([t]);
    // A timetable that does not match the stations one to one: left as it is.
    expect(splitNights({ ...t, legs: t.legs!.slice(1) }, BEFORE)).toHaveLength(1);
  });

  it('a stay that day, or one given as a length, is no night', () => {
    const day = [
      w('Boden', { kind: 'start' }),
      w('Umeå', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-27T20:00' }),
      w('Luleå', { kind: 'stop', dwellMin: 600 }),
      w('Kiruna', { kind: 'end' }),
    ];
    const t = planned(day, [
      ['2026-12-27T12:00:00Z', '2026-12-27T16:00:00Z'],
      ['2026-12-27T19:10:00Z', '2026-12-27T21:00:00Z'],
      ['2026-12-28T07:00:00Z', '2026-12-28T09:00:00Z'],
    ]);
    expect(splitNights(t, BEFORE)).toEqual([t]);
    expect(splitAllNights([t], BEFORE)).toEqual([t]);
  });

  it('a night train is a ride: a stay the morning it arrives is the same trip', () => {
    // Boden 22:18 → Stockholm 09:28 next day, a stay until 12:00 there, then on.
    const ws = [
      w('Boden', { kind: 'start' }),
      w('Stockholm', { kind: 'stop', dwellMin: 30, stayUntil: '2026-12-28T12:00' }),
      w('Göteborg', { kind: 'end' }),
    ];
    const t = planned(ws, [
      ['2026-12-27T21:18:00Z', '2026-12-28T08:28:00Z'],
      ['2026-12-28T11:10:00Z', '2026-12-28T14:30:00Z'],
    ]);
    expect(nightsOf(t)).toEqual([]);
    // Unplanned, the arrival's day is not known: never a night then (0.64.3).
    expect(nightsOf({ ...t, chain: undefined, legs: undefined })).toEqual([]);
  });

  it('split elsewhere already (a part synced in): the older copy is left, never a second part', () => {
    const t = planned(sweden, swedenTimes);
    const [, second] = splitNights(t, BEFORE);
    const list = [t, { ...second!, name: 'theirs' }];
    expect(splitAllNights(list, BEFORE)).toBe(list);
  });

  it('a new trip may start where the last one ahead ends, the day after', () => {
    const t = {
      ...newTrip(
        't',
        tour([w('Boden', { kind: 'start' }), w('Umeå', { kind: 'end' })]),
        undefined,
        undefined,
        new Date(0),
      ),
    };
    const now = Date.parse('2026-12-01T10:00:00Z');
    expect(onwardFrom([t], now, 'new')).toEqual({
      stopRef: 'ch:1:sloid:Umeå',
      name: 'Umeå',
      date: '2026-12-28',
      from: 'Boden',
    });
    expect(onwardFrom([t], now, 't')).toBeUndefined();
    expect(onwardFrom([t], Date.parse('2027-01-10T10:00:00Z'), 'new')).toBeUndefined();
  });

  it('after a night train, the day it arrives (0.64.3)', () => {
    const ws = [w('Zürich', { kind: 'start' }), w('Hamburg', { kind: 'end' })];
    const t = planned(ws, [['2026-12-27T19:00:00Z', '2026-12-28T07:00:00Z']]);
    expect(onwardFrom([t], BEFORE, 'new')?.date).toBe('2026-12-28');
  });
});
