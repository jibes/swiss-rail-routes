// Asked on the MCP, 5 Nov 2026: scenic lines by daylight, a stay that must end by a time (the
// attraction closes), and a round trip's way back the fastest.
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../src/core/export/routeLink';
import { setEntryLeaveBy, setEntryStay } from '../src/core/line';
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

describe('a stay with a time to leave by, or not before (F3)', () => {
  // Retest round 3, 6 Nov 2026: the option that cannot leave in time was still offered beside
  // the one that can. Once one can, only those that can are offered; when none can, each is said.
  it('leave by: only the options that leave in time are offered while any can', async () => {
    const r = await plan(visit({ leaveBy: '10:30' }), deps(day).deps);
    expect(r.recommended!.dep).toBe(day[0]!.dep);
    expect(r.recommended!.warnings.map((w) => w.type)).not.toContain('window-missed');
    expect(r.options!.map((o) => o.dep)).not.toContain(day[1]!.dep);
    // None can leave by 09:30: all are offered, each said late.
    const none = await plan(visit({ leaveBy: '09:30' }), deps(day).deps);
    const w = none.recommended!.warnings.find((x) => x.type === 'window-missed')!;
    expect(w.params).toMatchObject({ at: 'Luzern', time: '09:30' });
    // Without the time, both are just options.
    const free = await plan(visit({}), deps(day).deps);
    expect(free.options!.flatMap((o) => o.warnings).map((x) => x.type)).not.toContain(
      'window-missed',
    );
  });

  it('not before: the stay starts when it opens, so the next train is the later one', async () => {
    const r = await plan(visit({ arriveAfter: '09:30' }), deps(day).deps);
    expect(r.recommended!.connections[1]!.dep).toBe(day[3]!.dep);
    const free = await plan(visit({}), deps(day).deps);
    expect(free.recommended!.connections[1]!.dep).toBe(day[2]!.dep);
  });

  it('kept through storage, route links and trip links; older links never set it', async () => {
    const t = visit({ leaveBy: '17:30', arriveAfter: '10:00' });
    const back = sanitiseTour(t, DATE)!;
    expect(back.waypoints[1]).toMatchObject({ leaveBy: '17:30', arriveAfter: '10:00' });
    expect(sanitiseTour(visit({ leaveBy: '25:00' }), DATE)!.waypoints[1]!.leaveBy).toBeUndefined();

    const { stops, query } = routeParts(t, true);
    expect(stops).toContain('.f1000.u1730');
    const ctx = { templates, name: (r: string) => index.byRef(r)?.name, today: DATE };
    const read = parseRoute(stops, query, ctx)!;
    expect(read.waypoints[1]).toMatchObject({ leaveBy: '17:30', arriveAfter: '10:00' });
    // The old, never-enforced windows (a/b) are still read past.
    const old = parseRoute(stops.replace('.f1000.u1730', '.a1000.b1730'), query, ctx)!;
    expect(old.waypoints[1]!.leaveBy).toBeUndefined();

    const nameOf = (r: string) => index.byRef(stopKey(r))?.name;
    const r = await plan(t, deps(day).deps);
    const trip = newTrip('mine', { ...t, name: 'Luzern' }, r.legs!, r.recommended!, new Date(0));
    const opened = await decodeTripLink(await encodeTripLink(trip, nameOf), 'theirs', nameOf);
    expect(opened?.route.waypoints[1]).toMatchObject({ leaveBy: '17:30', arriveAfter: '10:00' });
  });
});

describe('editing the time to leave by', () => {
  it('only on a stay; riding through takes it away with the stay', () => {
    const t = visit({});
    const set = setEntryLeaveBy(t, 1, '17:30');
    expect(set.waypoints[1]!.leaveBy).toBe('17:30');
    expect(setEntryLeaveBy(set, 1, null).waypoints[1]!.leaveBy).toBeUndefined();
    // The start and a station ridden through have no stay to end.
    expect(setEntryLeaveBy(t, 0, '17:30').waypoints[0]!.leaveBy).toBeUndefined();
    const through = setEntryStay(set, 1, null);
    expect(through.waypoints[1]).not.toHaveProperty('leaveBy');
    expect(setEntryStay(set, 1, 45).waypoints[1]!.leaveBy).toBe('17:30');
  });
});
