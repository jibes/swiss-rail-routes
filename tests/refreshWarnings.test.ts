// Pull-to-reload asks the trains again; what the planner said about the plan stays said
// (review of 11 Nov 2026: a tight change between legs, a line not ridden and the choice's own
// notes were dropped for good).
import { describe, expect, it } from 'vitest';
import type { TripQuery } from '../src/core/ojp/request';
import { refreshChain } from '../src/core/refresh';
import { newTrip } from '../src/core/trip';
import type { Warning } from '../src/core/warnings';
import { addWaypoint, newTour } from './helpers/edit';
import { DATE, conn, deps, ref, ride } from './helpers/timetable';

describe('a trip reloaded', () => {
  it('keeps the tight change between legs and the planner’s notes on the choice', async () => {
    let route = newTour('t', DATE, { stopRef: ref('Zürich HB'), name: 'Zürich HB' });
    route = addWaypoint(route, { stopRef: ref('Luzern'), name: 'Luzern' });
    route = addWaypoint(route, { stopRef: ref('Interlaken Ost'), name: 'Interlaken Ost' });
    const a = conn(
      ride('IR 70', [
        ['Zürich HB', '08:04'],
        ['Luzern', '08:45'],
      ]),
    );
    const b = conn(
      ride('PE LIX', [
        ['Luzern', '08:47'],
        ['Interlaken Ost', '10:41'],
      ]),
    );
    const sparse: Warning = {
      type: 'sparse',
      severity: 'info',
      legIndex: 1,
      key: 'wSparse',
      params: {},
    };
    const trip = newTrip(
      't',
      { ...route, name: 'x' },
      [],
      { connections: [a, b], warnings: [sparse], score: 0, dep: a.dep, arr: b.arr },
      new Date(0),
    );
    const r = await refreshChain(trip, {
      ...deps([]).deps,
      today: DATE,
      ask: async (q: TripQuery) => (q.origin.name === 'Zürich HB' ? [a] : [b]),
    } as never);
    const types = r.chain.warnings.map((w) => `${w.type}@${w.legIndex}`);
    expect(types).toContain('tight-transfer@0');
    expect(types).toContain('sparse@1');
  });
});
