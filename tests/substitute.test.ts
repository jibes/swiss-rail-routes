// A station struck through: the stations to try in its place, the route with one, and whether a
// plan reaches it (src/core/substitute.ts), with the real stop index and a fake timetable.
import { describe, expect, it } from 'vitest';
import { entriesOf } from '../src/core/line';
import { plan } from '../src/core/planner/plan';
import { kmBetween } from '../src/core/stops';
import {
  candidates,
  MAX_TRIES,
  minutesLater,
  NEAR_KM,
  reaches,
  trialRoute,
} from '../src/core/substitute';
import { addWaypoint, newTour } from './helpers/edit';
import { conn, DATE, deps, index, ref, ride, templates } from './helpers/timetable';

const st = (n: string) => ({ stopRef: ref(n), name: n });
const albula = addWaypoint(
  addWaypoint(newTour('a', DATE, st('Chur')), st('Bergün/Bravuogn')),
  st('St. Moritz'),
);
const bern = addWaypoint(
  addWaypoint(addWaypoint(newTour('v', DATE, st('St. Gallen')), st('Wattwil')), st('Bern')),
  st('Luzern'),
);

describe('stations to try in place of one missed', () => {
  it('a line’s own stations first, then the nearest; at most three', () => {
    const c = candidates(albula, 1, index, templates);
    expect(c.map((x) => x.name)).toEqual(['Preda', 'Filisur', 'Davos Wiesen']);
    expect(c.map((x) => x.sameLine)).toEqual([true, true, false]);
    expect(c.length).toBeLessThanOrEqual(MAX_TRIES);
  });

  it('only stations trains call at (no funicular next door), never the route’s own, within reach', () => {
    const c = candidates(bern, 2, index, templates);
    expect(c.length).toBe(MAX_TRIES);
    const own = new Set(bern.waypoints.map((w) => w.stopRef));
    const at = index.byRef(ref('Bern'))!;
    for (const x of c) {
      expect(own.has(x.stopRef)).toBe(false);
      expect(index.byRef(x.stopRef)!.modes).toContain('TRAIN');
      expect(kmBetween(at, index.byRef(x.stopRef)!)).toBeLessThanOrEqual(NEAR_KM);
    }
    expect(c.map((x) => x.name)).not.toContain('Bern (Marzilibahn)');
    // Nearest first.
    expect([...c].sort((a, b) => a.km - b.km)).toEqual(c);
  });

  it('replan: never a station of the way here', () => {
    const c = candidates(albula, 1, index, templates, [ref('Preda')]);
    expect(c.map((x) => x.name)).not.toContain('Preda');
    expect(c[0]?.name).toBe('Filisur');
  });

  it('nothing for an entry that is not there or a stop the index does not know', () => {
    expect(candidates(albula, 9, index, templates)).toEqual([]);
    const unknown = {
      ...albula,
      waypoints: albula.waypoints.map((w, i) => (i === 1 ? { ...w, stopRef: 'x:1' } : w)),
    };
    expect(candidates(unknown, 1, index, templates)).toEqual([]);
  });

  it('the trial route has the other station in that place, the rest as it was', () => {
    const [c] = candidates(albula, 1, index, templates);
    const r = trialRoute(albula, 1, c!);
    expect(entriesOf(r).map((e) => e.w.name)).toEqual(['Chur', 'Preda', 'St. Moritz']);
    expect(r.date).toBe(albula.date);
  });

  it('a plan of the trial route reaches it; the original’s does not reach the one missed', async () => {
    const [c] = candidates(albula, 1, index, templates);
    const trial = trialRoute(albula, 1, c!);
    // RE through Preda, not Bergün (the fake timetable knows only this train).
    const re = conn(
      ride('RE 1', [
        ['Chur', '08:58'],
        ['Thusis', '09:23'],
        ['Preda', '10:10'],
        ['St. Moritz', '10:58'],
      ]),
    );
    const planned = await plan(trial, deps([re]).deps);
    const chain = planned.recommended ?? planned.options?.[0];
    expect(chain).toBeDefined();
    expect(reaches(trial, 1, chain!.connections)).toBe(true);
    expect(reaches(albula, 1, chain!.connections)).toBe(false);
  });

  it('minutes against the plan', () => {
    expect(minutesLater('2026-11-07T10:00:00Z', '2026-11-07T10:25:00Z')).toBe(25);
    expect(minutesLater('2026-11-07T10:00:00Z', '2026-11-07T09:50:00Z')).toBe(-10);
  });
});
