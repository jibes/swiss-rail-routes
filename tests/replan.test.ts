import { describe, expect, it } from 'vitest';
import { newTour, setStop } from '../src/core/edit';
import { liveState } from '../src/core/live';
import type { Leg, Waypoint } from '../src/core/model';
import { zurichDateTime } from '../src/core/ojp/request';
import { mergeReplan, remainingRoute, replanPoint } from '../src/core/replan';
import { newTrip } from '../src/core/trip';
import { DATE, conn, ref, ride } from './helpers/timetable';

const at = (hhmm: string) => Date.parse(zurichDateTime(`${DATE}T${hhmm}`));
const w = (name: string, kind: Waypoint['kind'] = 'via', dwellMin = 0): Waypoint => ({
  stopRef: ref(name),
  name,
  kind,
  dwellMin,
});

// Zürich → (Zug) → Luzern [stop 60] → Brienz → Interlaken Ost
const legs: Leg[] = [
  { index: 0, from: w('Zürich HB', 'start'), vias: [w('Zug')], to: w('Luzern', 'stop', 60) },
  { index: 1, from: w('Luzern', 'stop', 60), vias: [w('Brienz')], to: w('Interlaken Ost', 'end') },
];
const route = {
  ...newTour('r', DATE),
  name: 'Brünig',
  waypoints: [legs[0]!.from, legs[0]!.vias[0]!, legs[0]!.to, legs[1]!.vias[0]!, legs[1]!.to],
};
const chain = [
  conn(
    ride(
      'IR 70',
      [
        ['Zürich HB', '08:04'],
        ['Zug', '08:25'],
        ['Luzern', '08:45'],
      ],
      { journey: 'j1' },
    ),
  ),
  conn(
    ride(
      'PE LIX',
      [
        ['Luzern', '10:06'],
        ['Brienz', '11:20'],
        ['Interlaken Ost', '11:54'],
      ],
      { journey: 'j2' },
    ),
  ),
];
const trip = newTrip(
  't',
  route,
  legs,
  { connections: chain, warnings: [], score: 0, dep: chain[0]!.dep, arr: chain[1]!.arr },
  new Date(0),
);

describe('replanPoint', () => {
  it('riding: the next stop, the ride cut there', () => {
    const p = replanPoint(trip, liveState(chain, at('08:15')), at('08:15'))!;
    expect(p.stop.name).toBe('Zug');
    expect(p.at).toBe(at('08:25'));
    expect(p.leg).toBe(0);
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0]!.sections[0]!.to.name).toBe('Zug');
    expect(Date.parse(p.keep[0]!.arr)).toBe(at('08:25'));
  });

  it('waiting at a stop: from there, now', () => {
    const p = replanPoint(trip, liveState(chain, at('09:00')), at('09:00'))!;
    expect(p.stop.name).toBe('Luzern');
    expect(p.at).toBe(at('09:00'));
    expect(p.keep).toHaveLength(1); // the first connection, whole
    expect(p.leg).toBe(1);
  });

  it('before the trip: from the start; after it: nothing', () => {
    expect(replanPoint(trip, liveState(chain, at('07:00')), at('07:00'))!.keep).toEqual([]);
    expect(replanPoint(trip, liveState(chain, at('12:30')), at('12:30'))).toBeNull();
  });
});

describe('remainingRoute', () => {
  it('starts at the point, keeps unpassed vias, stops with their stays, the end', () => {
    const p = replanPoint(trip, liveState(chain, at('08:15')), at('08:15'))!;
    const r = remainingRoute(trip, p);
    expect(r.waypoints.map((x) => `${x.name}:${x.kind}:${x.dwellMin}`)).toEqual([
      'Zug:start:0',
      'Luzern:stop:60',
      'Brienz:via:0',
      'Interlaken Ost:end:0',
    ]);
    expect(r.anchor).toEqual({ departAt: '08:25' });
    expect(r.date).toBe(DATE);
  });

  it('from a stop, the rest of the next leg', () => {
    const p = replanPoint(trip, liveState(chain, at('09:00')), at('09:00'))!;
    const r = setStop(remainingRoute(trip, p), 1, true, 30); // a spontaneous stop in Brienz
    expect(r.waypoints.map((x) => `${x.name}:${x.kind}:${x.dwellMin}`)).toEqual([
      'Luzern:start:0',
      'Brienz:stop:30',
      'Interlaken Ost:end:0',
    ]);
  });
});

describe('remainingRoute: round trips', () => {
  it('keeps the way home when the trip ends where the point is', () => {
    // Luzern → Zürich → Luzern, replanned before departure: from Luzern, still back to Luzern.
    const loop: Leg[] = [
      { index: 0, from: w('Luzern', 'start'), vias: [], to: w('Zürich HB', 'stop', 30) },
      { index: 1, from: w('Zürich HB', 'stop', 30), vias: [], to: w('Luzern', 'end') },
    ];
    const c = [
      conn(
        ride(
          'IR',
          [
            ['Luzern', '08:10'],
            ['Zürich HB', '08:51'],
          ],
          { journey: 'a' },
        ),
      ),
      conn(
        ride(
          'IR',
          [
            ['Zürich HB', '09:30'],
            ['Luzern', '10:10'],
          ],
          { journey: 'b' },
        ),
      ),
    ];
    const t = newTrip(
      'l',
      { ...newTour('r2', DATE), waypoints: [loop[0]!.from, loop[0]!.to, loop[1]!.to] },
      loop,
      { connections: c, warnings: [], score: 0, dep: c[0]!.dep, arr: c[1]!.arr },
      new Date(0),
    );
    const p = replanPoint(t, liveState(c, at('07:50')), at('07:50'))!;
    expect(remainingRoute(t, p).waypoints.map((x) => `${x.name}:${x.kind}`)).toEqual([
      'Luzern:start',
      'Zürich HB:stop',
      'Luzern:end',
    ]);
  });
});

describe('mergeReplan', () => {
  it('keeps the travelled part, appends the new plan, re-indexes legs and warnings', () => {
    const p = replanPoint(trip, liveState(chain, at('09:00')), at('09:00'))!;
    const fresh = conn(
      ride('R 2', [
        ['Luzern', '09:35'],
        ['Brienz', '10:50'],
      ]),
    );
    const v = mergeReplan(
      trip,
      p,
      [{ index: 0, from: w('Luzern', 'start'), vias: [], to: w('Brienz', 'end') }],
      {
        connections: [fresh],
        warnings: [
          {
            type: 'tight-transfer',
            severity: 'warn',
            legIndex: 0,
            key: 'wTightTransfer',
            params: {},
          },
        ],
        score: 1,
        dep: fresh.dep,
        arr: fresh.arr,
      },
    );
    expect(v.chain.connections).toHaveLength(2);
    expect(v.chain.dep).toBe(chain[0]!.dep);
    expect(v.chain.arr).toBe(fresh.arr);
    expect(v.legs.map((l) => l.index)).toEqual([0, 1]);
    expect(v.chain.warnings[0]!.legIndex).toBe(1);
  });
});
