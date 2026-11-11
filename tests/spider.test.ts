import { describe, expect, it } from 'vitest';
import type { Section } from '../src/core/model';
import type { Departures } from '../src/core/ojp/departures';
import { biggest, estimate, HORIZON_MIN, leaveTime, spiderWeb } from '../src/core/spider';

const P: Record<string, { lat: number; lon: number }> = {
  A: { lat: 46.0, lon: 7.0 },
  B: { lat: 46.1, lon: 7.0 },
  C: { lat: 46.2, lon: 7.0 },
  D: { lat: 46.0, lon: 7.2 },
};
const at = (h: number, m: number) =>
  `2026-11-07T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const call = (k: string, arr?: string, dep?: string) => ({
  stopRef: `ch:1:sloid:${k}`,
  name: k,
  arr,
  dep,
});
const ride = (dep: string, calls: [string, string][], line = 'R1'): Section => ({
  mode: 'rail',
  line,
  category: 'R',
  from: call('A', undefined, dep),
  to: call(calls.at(-1)![0], calls.at(-1)![1]),
  intermediate: calls.slice(0, -1).map(([k, t]) => call(k, t, t)),
});
const place = (k: string) => P[k.replace('ch:1:sloid:', '')];

describe('the map planner’s web', () => {
  const d: Departures = {
    places: new Map(),
    rides: [
      // An express: 22 km in 15 minutes.
      ride(at(9, 0), [
        ['B', at(9, 8)],
        ['C', at(9, 15)],
      ]),
      // The same line an hour later: not drawn twice, nor earlier anywhere.
      ride(at(10, 0), [
        ['B', at(10, 20)],
        ['C', at(10, 40)],
      ]),
      // Shortened: held stop for stop by the first, not drawn again.
      ride(at(9, 30), [['B', at(9, 50)]]),
      ride(at(9, 10), [['D', at(9, 30)]], 'S2'),
      // Before the time asked, and past the horizon: neither counts.
      ride(at(8, 0), [['D', at(8, 5)]]),
      ride(at(9 + HORIZON_MIN / 60 + 1, 0), [['D', at(13, 0)]]),
    ],
  };
  const web = spiderWeb(d, { from: 'ch:1:sloid:A', at: at(9, 0), place });

  it('every place reached without a change, by its earliest train', () => {
    expect(web.reached.map((r) => [r.name, r.arr.slice(11, 16)])).toEqual([
      ['B', '08:08'],
      ['C', '08:15'],
      ['D', '08:30'],
    ]);
    expect(web.reached.find((r) => r.name === 'D')!.line).toBe('S2');
  });

  it('each line once, through its stops from where it starts', () => {
    expect(web.lines.map((l) => l.keys.map((k) => k.slice(-1)).join('>'))).toEqual([
      'A>B>C',
      'A>D',
    ]);
    expect(web.lines[0]!.coords[0]).toEqual([7.0, 46.0]);
  });

  it('the biggest places: those most trains from here call at', () => {
    // B: three trains, C two, D one.
    expect(web.reached.map((r) => [r.name, r.calls])).toEqual([
      ['B', 3],
      ['C', 2],
      ['D', 1],
    ]);
    expect([...biggest(web, 2)].map((k) => k.slice(-1))).toEqual(['B', 'C']);
  });

  it('a place no train reaches: about, by the nearest place reached and a change', () => {
    const far = { lat: 46.3, lon: 7.0 };
    const e = estimate(web, at(9, 0), P.A!, far);
    expect(e.via?.name).toBe('C');
    // 15 min to C, 10 to change, about 11 km at 45 km/h: sooner than 33 km straight from A.
    expect(e.minutes).toBe(40);
  });
});

// Third audit, 11 Nov 2026: a line ending at stop 7 counted as held by one passing stop 7000.
it('a line is held only by one with the same stops, not ones whose numbers begin alike', () => {
  const d: Departures = {
    places: new Map(),
    rides: [
      ride(at(9, 0), [
        ['B', at(9, 8)],
        ['C', at(9, 15)],
      ]),
      ride(at(9, 5), [
        ['B', at(9, 12)],
        ['CD', at(9, 20)],
        ['D', at(9, 30)],
      ]),
    ],
  };
  const both: Record<string, { lat: number; lon: number }> = { ...P, CD: { lat: 46.3, lon: 7.1 } };
  const web = spiderWeb(d, {
    from: 'ch:1:sloid:A',
    at: at(9, 0),
    place: (k) => both[k.replace('ch:1:sloid:', '')],
  });
  expect(web.lines).toHaveLength(2);
});

describe('when you leave a station of the trip', () => {
  const route = {
    date: '2026-11-07',
    anchor: { departAt: '08:30' },
    waypoints: [
      { stopRef: 'ch:1:sloid:A', name: 'A', kind: 'start', dwellMin: 0 },
      { stopRef: 'ch:1:sloid:B', name: 'B', kind: 'stop', dwellMin: 30 },
    ],
  } as never;
  const s = ride(at(9, 0), [['B', at(9, 20)]]);
  const c = [{ legIndex: 0, dep: s.from.dep!, arr: s.to.arr!, transfers: 0, sections: [s] }];

  it('the plan’s train from it; its arrival and stay; else when the trip leaves', () => {
    expect(leaveTime(route, c, 'ch:1:sloid:A')).toBe('2026-11-07T09:00');
    expect(leaveTime(route, c, 'ch:1:sloid:B')).toBe('2026-11-07T09:50');
    expect(leaveTime(route, undefined, 'ch:1:sloid:B')).toBe('2026-11-07T08:30');
  });
});
