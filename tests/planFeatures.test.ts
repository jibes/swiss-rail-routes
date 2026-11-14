// Asked on the MCP, 5 Nov 2026: scenic lines by daylight, a stay that must end by a time (the
// attraction closes), and a round trip's way back the fastest.
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../src/core/export/routeLink';
import { DEFAULT_STAY, setEntryStay, setEntryStayUntil, UNTIL_DWELL } from '../src/core/line';
import { decodeTripLink, encodeTripLink } from '../src/core/export/tripLink';
import type { Tour } from '../src/core/model';
import { plan } from '../src/core/planner/plan';
import { stopKey } from '../src/core/stops';
import { sanitiseTour } from '../src/core/tour';
import { linesAfterDark } from '../src/core/warnings';
import { newTrip } from '../src/core/trip';
import { insertTemplate, newTour } from './helpers/edit';
import { routeParts } from './helpers/routeLink';
import { DATE, conn, deps, index, ref, ride, templates } from './helpers/timetable';

const st = (name: string) => ({ stopRef: ref(name), name });
const albula = templates.find((t) => t.id === 'albula')!;
const albulaRide = (dep: string, mid: string, arr: string) =>
  conn(
    ride('RE 1141', [
      ['Chur', dep],
      ['Thusis', dep],
      ['Filisur', mid],
      ['Bergün/Bravuogn', mid],
      ['Preda', mid],
      ['St. Moritz', arr],
    ]),
  );
const onAlbula: Tour = {
  ...insertTemplate(newTour('t', DATE, st('Chur')), albula),
  anchor: { departAt: '12:00' },
};

describe('scenic lines by daylight (F2)', () => {
  const ctx = { templates: [albula], stop: (r: string) => index.byRef(r), date: DATE };

  it('a line ridden into the dark is said from when it is dark; by day nothing', () => {
    // 7 Nov at Filisur: sunset about 16:57, dark from about 17:12.
    const dusk = linesAfterDark(albulaRide('15:58', '17:00', '18:00'), ctx);
    expect(dusk.map((d) => d.template.id)).toEqual(['albula']);
    const at = new Intl.DateTimeFormat('de-CH', {
      timeZone: 'Europe/Zurich',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dusk[0]!.from);
    expect(at).toMatch(/^17:(0[5-9]|1\d)$/);
    expect(linesAfterDark(albulaRide('12:58', '14:00', '15:00'), ctx)).toEqual([]);
    // Before sunrise too (review, 0.65.1: 7 Nov sunrise about 07:25): dark from its start.
    const dawn = linesAfterDark(albulaRide('05:58', '06:30', '07:00'), ctx);
    expect(dawn.map((d) => d.template.id)).toEqual(['albula']);
    expect(
      new Intl.DateTimeFormat('de-CH', {
        timeZone: 'Europe/Zurich',
        hour: '2-digit',
        minute: '2-digit',
      }).format(dawn[0]!.from),
    ).toBe('05:58');
  });

  it('of two otherwise equal options, the one by daylight is recommended and the other said', async () => {
    // Without highlights, so only the line's own darkness counts: the late one is 10 min shorter.
    const plain = templates.map((t) => (t.id === 'albula' ? { ...t, highlights: [] } : t));
    const day = albulaRide('12:58', '14:00', '15:00');
    const late = albulaRide('15:58', '17:00', '17:50');
    const d = deps([day, late]);
    const r = await plan(onAlbula, { ...d.deps, templates: plain });
    expect(r.recommended!.dep).toBe(day.dep);
    const other = r.options!.find((o) => o.dep === late.dep)!;
    expect(other.warnings.map((w) => w.type)).toContain('line-after-dark');
    expect(r.recommended!.warnings.map((w) => w.type)).not.toContain('line-after-dark');
  });
});

// Zürich HB → Luzern (stay 60, leave by / open at) → Bern.
const there = (dep: string, arr: string) =>
  conn(
    ride('IR 70', [
      ['Zürich HB', dep],
      ['Luzern', arr],
    ]),
  );
const on = (dep: string, arr: string) =>
  conn(
    ride('IR 26', [
      ['Luzern', dep],
      ['Bern', arr],
    ]),
  );
const visit = (luzern: Partial<Tour['waypoints'][number]>): Tour => ({
  ...newTour('t', DATE),
  anchor: { departAt: '08:00' },
  waypoints: [
    { ...st('Zürich HB'), kind: 'start', dwellMin: 0 },
    { ...st('Luzern'), kind: 'stop', dwellMin: 60, ...luzern },
    { ...st('Bern'), kind: 'end', dwellMin: 0 },
  ],
});
const day = [
  there('08:00', '08:50'),
  there('09:00', '09:50'),
  on('10:00', '11:00'),
  on('11:00', '12:00'),
];

describe('a time to leave by, read as a stay until then (0.67.0)', () => {
  it('older links and data: leave by becomes a stay until that time, come after is dropped', () => {
    const t = visit({});
    const old = {
      ...t,
      waypoints: t.waypoints.map((w, i) =>
        i === 1 ? { ...w, leaveBy: '17:30', arriveAfter: '10:00' } : w,
      ),
    };
    const back = sanitiseTour(old, DATE)!;
    expect(back.waypoints[1]).toMatchObject({ stayUntil: `${DATE}T17:30` });
    expect(back.waypoints[1]).not.toHaveProperty('leaveBy');
    expect(back.waypoints[1]).not.toHaveProperty('arriveAfter');

    const { stops, query } = routeParts(old, true);
    expect(stops).toContain('.f1000.u1730');
    const ctx = { templates, name: (r: string) => index.byRef(r)?.name, today: DATE };
    const read = parseRoute(stops, query, ctx)!;
    expect(read.waypoints[1]).toMatchObject({ stayUntil: `${DATE}T17:30` });
    expect(read.waypoints[1]).not.toHaveProperty('arriveAfter');
    // The old, never-enforced windows (a/b) are still read past.
    const older = parseRoute(stops.replace('.f1000.u1730', '.a1000.b1730'), query, ctx)!;
    expect(older.waypoints[1]!.stayUntil).toBeUndefined();
  });
});

describe('a stay until a date and time, over several days (0.44.0)', () => {
  it('the next train leaves no earlier, the day after too; never dropped as a late day trip', async () => {
    const t = visit({ stayUntil: `${DATE}T10:15` });
    const r = await plan(t, deps(day).deps);
    expect(r.recommended!.connections[1]!.dep).toBe(day[3]!.dep);
  });

  it('kept through storage, route links and trip links; riding through drops it', async () => {
    const t = visit({ stayUntil: '2026-11-09T08:00' });
    expect(sanitiseTour(t, DATE)!.waypoints[1]!.stayUntil).toBe('2026-11-09T08:00');
    expect(
      sanitiseTour(visit({ stayUntil: '2026-11-09 08:00' }), DATE)!.waypoints[1]!.stayUntil,
    ).toBeUndefined();
    const { stops, query } = routeParts(t, true);
    const ctx = { templates, name: (r: string) => index.byRef(r)?.name, today: DATE };
    const tokens = stops.split('~');
    tokens[1] += '.n202611090800';
    const read = parseRoute(tokens.join('~'), query, ctx)!;
    expect(read.waypoints[1]!.stayUntil).toBe('2026-11-09T08:00');
    const nameOf = (r: string) => index.byRef(stopKey(r))?.name;
    const r = await plan(visit({}), deps(day).deps);
    const trip = newTrip('mine', { ...t, name: 'Luzern' }, r.legs!, r.recommended!, new Date(0));
    const opened = await decodeTripLink(await encodeTripLink(trip, nameOf), 'theirs', nameOf);
    expect(opened?.route.waypoints[1]!.stayUntil).toBe('2026-11-09T08:00');
    const set = setEntryStayUntil(visit({}), 1, '2026-11-09T08:00');
    expect(set.waypoints[1]!.stayUntil).toBe('2026-11-09T08:00');
    expect(setEntryStay(set, 1, null).waypoints[1]).not.toHaveProperty('stayUntil');
    expect(setEntryStayUntil(set, 1, null).waypoints[1]).not.toHaveProperty('stayUntil');
    // One kept (0.51.0): a time sets the least length beside it; a length takes the time away.
    expect(set.waypoints[1]!.dwellMin).toBe(UNTIL_DWELL);
    expect(setEntryStay(set, 1, 45).waypoints[1]).toMatchObject({ kind: 'stop', dwellMin: 45 });
    expect(setEntryStay(set, 1, 45).waypoints[1]).not.toHaveProperty('stayUntil');
    // Its time taken away, a stay is a stay's length again, not a minute.
    expect(setEntryStayUntil(set, 1, null).waypoints[1]!.dwellMin).toBe(DEFAULT_STAY);
  });
});

// Round 3, 6 Nov 2026 (R3-2/R3-3): waiting after the time asked for cost nothing, so a ride a
// minute shorter four hours later was recommended. Now the time from the asked one counts.
describe('waiting counts as travel', () => {
  const zl = (dep: string, arr: string) =>
    conn(
      ride('IR 70', [
        ['Zürich HB', dep],
        ['Luzern', arr],
      ]),
    );
  const route = (anchor: Tour['anchor']): Tour => ({
    ...newTour('w', DATE, st('Zürich HB')),
    waypoints: [
      { ...newTour('w', DATE, st('Zürich HB')).waypoints[0]! },
      { stopRef: ref('Luzern'), name: 'Luzern', kind: 'end', dwellMin: 0 },
    ],
    anchor,
  });

  it('depart at 09:00: the 09:05, not the 13:05 a minute shorter', async () => {
    const early = zl('09:05', '09:56');
    const late = zl('13:05', '13:55');
    const r = await plan(route({ departAt: '09:00' }), deps([early, late]).deps);
    expect(r.recommended!.dep).toBe(early.dep);
  });

  it('arrive by 18:00: the one arriving 17:56, not the 17:25 a minute shorter', async () => {
    const early = zl('16:35', '17:25');
    const late = zl('17:05', '17:56');
    const r = await plan(route({ arriveBy: '18:00' }), deps([early, late]).deps);
    expect(r.recommended!.dep).toBe(late.dep);
  });
});
