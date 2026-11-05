// Reported on the MCP, 5 Nov 2026: a scenic line asked for was dropped without a word (the
// Albula, closed Thusis–Preda, planned via the Vereina and recommended), and a day trip was
// offered with its way back the next morning.
import { describe, expect, it } from 'vitest';
import type { Tour } from '../src/core/model';
import { plan } from '../src/core/planner/plan';
import { plannedRows } from '../src/core/rows';
import {
  addWaypoint,
  insertTemplate,
  newTour,
  setDwell,
  setRoundTrip,
  setStop,
} from './helpers/edit';
import { DATE, conn, deps, ref, ride, templates } from './helpers/timetable';

const st = (name: string) => ({ stopRef: ref(name), name });
const albula = templates.find((t) => t.id === 'albula')!;
const chur: Tour = {
  ...insertTemplate(newTour('t', DATE, st('Chur')), albula),
  anchor: { departAt: '08:00' },
};

// The Albula by road: an express replacement bus from Thusis straight to Preda (as on 6 Nov).
const byRoad = conn(
  ride('S 1', [
    ['Chur', '08:38'],
    ['Thusis', '09:19'],
  ]),
  ride(
    'EV 3',
    [
      ['Thusis', '09:25'],
      ['Preda', '10:20'],
    ],
    { mode: 'bus' },
  ),
  ride('IR 38', [
    ['Preda', '10:28'],
    ['St. Moritz', '10:55'],
  ]),
);
// The other way to St. Moritz: the Vereina, quicker.
const vereina = conn(
  ride('S 1', [
    ['Chur', '08:01'],
    ['Landquart', '08:12'],
  ]),
  ride('RE 1', [
    ['Landquart', '08:16'],
    ['Klosters Platz', '08:50'],
    ['Sagliains', '09:20'],
    ['St. Moritz', '10:12'],
  ]),
);

describe('a scenic line asked for (B1)', () => {
  it('its own replacement bus rides the line by road: nothing dropped, nothing missed', async () => {
    const r = await plan(chur, deps([vereina, byRoad]).deps);
    expect(r.relaxed).toEqual([]);
    const best = r.recommended!;
    expect(best.connections[0]!.sections.some((s) => s.category === 'EV')).toBe(true);
    expect(best.warnings.map((w) => w.type)).toContain('replacement-bus');
    expect(best.warnings.map((w) => w.type)).not.toContain('line-missed');
    // The line agrees: Filisur and Bergün are passed by road, not struck through.
    const missed = plannedRows(chur, best.connections).filter(
      (x) => x.type === 'station' && x.missed,
    );
    expect(missed).toEqual([]);
  });

  it('a plan that cannot ride it says so as an error, naming the line and its stations', async () => {
    const r = await plan(chur, deps([vereina]).deps);
    expect(r.relaxed).toEqual([{ legIndex: 0, rule: 'mustPass' }]);
    const w = r.recommended!.warnings.find((x) => x.type === 'line-missed')!;
    expect(w).toMatchObject({ severity: 'error', legIndex: 0, key: 'wLineMissed' });
    expect(w.params.line).toBe('Albula');
    expect(String(w.params.stations)).toContain('Bergün');
  });
});

describe('a day trip back the next morning (B2)', () => {
  const lugano = (dwell: number): Tour => {
    let t = addWaypoint(newTour('t', DATE, st('Zürich HB')), st('Lugano'));
    t = setRoundTrip(t, true);
    t = setDwell(setStop(t, 1, true), 1, dwell);
    return { ...t, anchor: { departAt: '08:00' } };
  };
  const out = (dep: string, arr: string) =>
    conn(
      ride('IC 2', [
        ['Zürich HB', dep],
        ['Lugano', arr],
      ]),
    );
  const back = (dep: string, arr: string, nextDay = false) => {
    const c = conn(
      ride('IC 2', [
        ['Lugano', dep],
        ['Zürich HB', arr],
      ]),
    );
    if (!nextDay) return c;
    const s = c.sections[0]!;
    const arrIso = new Date(Date.parse(s.to.arr!) + 86_400_000).toISOString();
    return { ...c, arr: arrIso, sections: [{ ...s, to: { ...s.to, arr: arrIso } }] };
  };

  it('is not offered while one comes back the same day', async () => {
    const list = [out('08:09', '10:08'), out('11:09', '13:08'), back('12:00', '14:00')];
    list.push(back('23:30', '06:55', true));
    const r = await plan(lugano(60), deps(list).deps);
    expect(r.options!.length).toBeGreaterThan(0);
    for (const c of r.options!) expect(c.arr.slice(0, 10)).toBe(DATE);
  });

  it('is said when it is the only way back', async () => {
    const r = await plan(
      lugano(60),
      deps([out('11:09', '13:08'), back('23:30', '06:55', true)]).deps,
    ).then((x) => x.recommended!);
    const w = r.warnings.find((x) => x.type === 'next-day')!;
    expect(w).toMatchObject({ severity: 'warn', key: 'wNextDay' });
    expect(w.params.time).toBe('06:55');
  });
});
