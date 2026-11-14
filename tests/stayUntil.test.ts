// A stay until a date and time (0.44.0, one row since 0.51.0): the places it was lost or
// misread (review of 11 Nov 2026), each said where it went wrong.
import { describe, expect, it } from 'vitest';
import { normalise } from '../src/core/edit';
import { liveState } from '../src/core/live';
import type { Leg, Tour, Waypoint } from '../src/core/model';
import { zurichDateTime } from '../src/core/ojp/request';
import { plan } from '../src/core/planner/plan';
import { remainingRoute, replanPoint } from '../src/core/replan';
import { staysOnDay } from '../src/core/stay';
import { newTrip } from '../src/core/trip';
import { newTour } from './helpers/edit';
import { DATE, conn, deps, ref, ride } from './helpers/timetable';

const at = (hhmm: string) => Date.parse(zurichDateTime(`${DATE}T${hhmm}`));
const w = (name: string, kind: Waypoint['kind'] = 'via', dwellMin = 0, x = {}): Waypoint => ({
  stopRef: ref(name),
  name,
  kind,
  dwellMin,
  ...x,
});
const NEXT = '2026-11-08';

describe('a stay until a time', () => {
  it('changing the rest during it leaves when it ends, not now', () => {
    const lu = w('Luzern', 'stop', 1, { stayUntil: `${DATE}T10:00` });
    const legs: Leg[] = [
      { index: 0, from: w('Zürich HB', 'start'), vias: [], to: lu },
      { index: 1, from: lu, vias: [], to: w('Interlaken Ost', 'end') },
    ];
    const route = { ...newTour('r', DATE), waypoints: [legs[0]!.from, lu, legs[1]!.to] };
    const chain = [
      conn(
        ride(
          'IR 70',
          [
            ['Zürich HB', '08:04'],
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
    const p = replanPoint(trip, liveState(chain, at('08:50')), at('08:50'))!;
    expect(remainingRoute(trip, p).anchor).toEqual({ departAt: '10:00' });
  });

  it('moves with the trip’s day, whole days, its clock time kept', () => {
    const ws = [w('Luzern', 'stop', 1, { stayUntil: '2026-11-08T09:15' }), w('Bern', 'end')];
    expect(staysOnDay(ws, '2026-11-07', '2026-11-14')[0]!.stayUntil).toBe('2026-11-15T09:15');
    expect(staysOnDay(ws, '2026-11-07', '2026-11-07')).toBe(ws);
    // Across the month's end and the clock change.
    expect(staysOnDay(ws, '2026-11-07', '2026-10-24')[0]!.stayUntil).toBe('2026-10-25T09:15');
  });

  it('goes with the stay: a station that is no stop keeps no time to end by', () => {
    const out = normalise([
      w('Zürich HB', 'start'),
      w('Luzern', 'stop', 1, { stayUntil: '2026-11-08T09:00' }),
    ]);
    expect(out[1]).toEqual(w('Luzern', 'end'));
  });

  it('arrive-by over two days arrives by that time on the last day', async () => {
    const r2 = (d: string, line: string, calls: [string, string][]) => {
      const s = ride(line, calls);
      const fix = <T extends { dep?: string; arr?: string }>(x: T): T => ({
        ...x,
        ...(x.dep ? { dep: zurichDateTime(`${d}T${x.dep.slice(11, 16)}`) } : {}),
        ...(x.arr ? { arr: zurichDateTime(`${d}T${x.arr.slice(11, 16)}`) } : {}),
      });
      return conn({
        ...s,
        from: fix(s.from),
        to: fix(s.to),
        intermediate: s.intermediate.map(fix),
      });
    };
    const t: Tour = {
      ...newTour('t', DATE),
      anchor: { arriveBy: '12:00' },
      waypoints: [
        w('Zürich HB', 'start'),
        w('Luzern', 'stop', 1, { stayUntil: `${NEXT}T09:00` }),
        w('Bern', 'end'),
      ],
    };
    const d = deps([
      r2(DATE, 'IR 70', [
        ['Zürich HB', '08:00'],
        ['Luzern', '08:50'],
      ]),
      r2(NEXT, 'IR 75', [
        ['Luzern', '10:00'],
        ['Bern', '11:00'],
      ]),
    ]);
    const r = await plan(t, d.deps);
    expect(r.recommended?.arr).toBe(zurichDateTime(`${NEXT}T11:00`));
  });
});

// Second audit (11 Nov 2026): a stay into a later day, read on the day you are there.
describe('a trip over two days', () => {
  it('changing the rest mid-ride leaves the leg end’s stay times with that end', async () => {
    const { mergeReplan } = await import('../src/core/replan');
    const lu = w('Luzern', 'stop', 1, { stayUntil: '2099-01-01T09:00', leaveBy: '23:00' });
    const legs: Leg[] = [
      { index: 0, from: w('Zürich HB', 'start'), vias: [], to: lu },
      { index: 1, from: lu, vias: [], to: w('Interlaken Ost', 'end') },
    ];
    const route = { ...newTour('r', DATE), waypoints: [legs[0]!.from, lu, legs[1]!.to] };
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
          'PE',
          [
            ['Luzern', '10:06'],
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
    const p = replanPoint(trip, liveState(chain, at('08:15')), at('08:15'))!;
    const rest = remainingRoute(trip, p);
    const m = mergeReplan(
      trip,
      p,
      [{ index: 0, from: rest.waypoints[0]!, vias: [], to: rest.waypoints.at(-1)! }],
      { connections: [chain[1]!], warnings: [], score: 0, dep: chain[1]!.dep, arr: chain[1]!.arr },
    );
    const zug = m.route.waypoints.find((x) => x.name === 'Zug')!;
    expect(zug).not.toHaveProperty('stayUntil');
  });

  it('a scenic line on day 2 is dark by day 2’s sunset, not day 1’s', async () => {
    const { linesAfterDark } = await import('../src/core/warnings');
    const { templates, index } = await import('./helpers/timetable');
    const day2 = (t: string) => zurichDateTime(`${NEXT}T${t}`);
    const names = ['Chur', 'Thusis', 'Filisur', 'Preda', 'Samedan'];
    const times = ['09:00', '09:30', '10:00', '10:30', '11:00'];
    const pts = names.map((n, i) => ({
      stopRef: ref(n),
      name: n,
      dep: day2(times[i]!),
      arr: day2(times[i]!),
    }));
    const c = conn({
      mode: 'rail',
      category: 'RE',
      number: '1',
      from: { ...pts[0]!, arr: undefined },
      to: { ...pts.at(-1)!, dep: undefined },
      intermediate: pts.slice(1, -1),
    } as never);
    const stop = (k: string) => index.byRef(k);
    const albula = templates.filter((x) => x.id === 'albula');
    expect(linesAfterDark(c, { templates: albula, stop, date: DATE })).toEqual([]);
  });
});
