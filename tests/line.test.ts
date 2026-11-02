import { describe, expect, it } from 'vitest';
import { insertTemplate, newTour } from './helpers/edit';
import {
  dropLine,
  entriesOf,
  lineTo,
  insertEntries,
  lineEntries,
  linesLostByMove,
  markRings,
  moveEntry,
  removeEntry,
  replaceEntry,
  routeKey,
  setEntryStay,
  stationEntry,
} from '../src/core/line';
import type { Tour } from '../src/core/model';
import { dayOf, newTrip, zurichTime } from '../src/core/trip';
import { retire } from '../src/core/retire';
import { plannedRows, routeRows } from '../src/core/rows';

const s = (name: string) => ({ stopRef: `ch:1:sloid:${name}`, name });
const VAE = {
  id: 'vae',
  chain: ['StGallen', 'Herisau', 'Wattwil', 'Luzern'].map((n) => ({
    ref: `ch:1:sloid:${n}`,
    name: n,
  })),
  mustPass: ['ch:1:sloid:Herisau', 'ch:1:sloid:Wattwil'],
};
const BRUENIG = {
  id: 'bruenig',
  chain: ['Luzern', 'Giswil', 'Interlaken'].map((n) => ({ ref: `ch:1:sloid:${n}`, name: n })),
  mustPass: ['ch:1:sloid:Giswil'],
};
const names = (t: Pick<Tour, 'waypoints'>) =>
  t.waypoints.map((w) => `${w.name}${w.ring ? '°' : ''}:${w.kind}`);
const start = () => insertEntries(newTour('t', '2026-11-07'), -1, [stationEntry(s('Zurich'))]);
const trip = () => {
  let t = start();
  t = insertEntries(t, 0, lineEntries(VAE));
  t = insertEntries(t, 2, lineEntries(BRUENIG));
  return insertEntries(t, 3, [stationEntry(s('Bern'))]);
};

describe('the line: entries and scenic lines', () => {
  const tags = (t: Pick<Tour, 'waypoints'>) =>
    t.waypoints.map((w) => `${w.name}${w.templateId ? `@${w.templateId}` : ''}`);
  const LAKE = {
    id: 'lake',
    chain: ['Vitznau', 'Weggis', 'Luzern'].map((n) => ({ ref: `ch:1:sloid:${n}`, name: n })),
    mustPass: [],
  };

  it('removing, replacing or moving a line’s end leaves no line behind', () => {
    // Zurich, StGallen@vae, (rings), Luzern@vae, …: remove Luzern (entry 2).
    const t = insertEntries(start(), 0, lineEntries(VAE));
    expect(tags(removeEntry(t, 2))).toEqual(['Zurich', 'StGallen']);
    expect(tags(replaceEntry(t, 2, s('Bern')))).toEqual(['Zurich', 'StGallen', 'Bern']);
    const moved = moveEntry(insertEntries(t, 2, [stationEntry(s('Bern'))]), 2, 3);
    expect(tags(moved)).toEqual(['Zurich', 'StGallen', 'Bern', 'Luzern']);
  });

  it('knows a line without must-pass stations by its two ends, and drops it', () => {
    const t = insertEntries(start(), 0, lineEntries(LAKE));
    const e = entriesOf(t);
    expect(lineTo(e, 2)).toBe('lake');
    expect(tags(dropLine(t, 2))).toEqual(['Zurich', 'Vitznau', 'Luzern']);
  });

  it('a line ending at the next station leads there, without a second one', () => {
    const t = insertEntries(start(), 0, [stationEntry(s('Luzern'))]);
    const withLine = insertEntries(t, 0, lineEntries(BRUENIG, true));
    expect(names(insertEntries(t, 0, lineEntries(VAE)))).toEqual([
      'Zurich:start',
      'StGallen:via',
      'Herisau°:via',
      'Wattwil°:via',
      'Luzern:end',
    ]);
    expect(withLine.waypoints.filter((w) => w.name === 'Luzern')).toHaveLength(1);
  });

  it('adds a line as its two ends, the must-pass stations as rings, continuing where you are', () => {
    expect(names(trip())).toEqual([
      'Zurich:start',
      'StGallen:via',
      'Herisau°:via',
      'Wattwil°:via',
      'Luzern:via',
      'Giswil°:via',
      'Interlaken:via',
      'Bern:end',
    ]);
    expect(entriesOf(trip()).map((e) => e.w.name)).toEqual([
      'Zurich',
      'StGallen',
      'Luzern',
      'Interlaken',
      'Bern',
    ]);
  });

  it('reads lines saved before 0.4.0 (two lines in a row share their station)', () => {
    let old: Tour = {
      ...newTour('t', '2026-11-07'),
      waypoints: [{ ...s('Zurich'), kind: 'start', dwellMin: 0 }],
    };
    old = insertTemplate(old, VAE);
    old = insertTemplate(old, BRUENIG);
    expect(markRings(old.waypoints).map((w) => !!w.ring)).toEqual([
      false,
      false,
      true,
      true,
      false,
      true,
      false,
    ]);
  });

  it('reads an old out-and-back line: the turnaround stays yours', () => {
    let old: Tour = {
      ...newTour('t', '2026-11-07'),
      waypoints: [{ ...s('StGallen'), kind: 'start', dwellMin: 0 }],
    };
    old = insertTemplate(old, VAE);
    old = insertTemplate(old, VAE, true);
    const rings = markRings(old.waypoints).map((w) => `${w.name}${w.ring ? '°' : ''}`);
    expect(rings).toContain('Luzern');
    expect(rings.filter((n) => n.endsWith('°')).length).toBeGreaterThan(0);
  });

  it('moving a station switches off the lines it touches, and only those', () => {
    const t = trip();
    // Bern (4) up between StGallen and Luzern: the Voralpen line (into Luzern) goes, Brünig stays?
    // Brünig led from Luzern to Interlaken; Luzern is now after Bern, so Brünig still starts there.
    expect(linesLostByMove(t, 4, 2)).toEqual(['vae']);
    const moved = moveEntry(t, 4, 2);
    expect(entriesOf(moved).map((e) => e.w.name)).toEqual([
      'Zurich',
      'StGallen',
      'Bern',
      'Luzern',
      'Interlaken',
    ]);
    expect(names(moved).filter((n) => n.includes('°'))).toEqual(['Giswil°:via']);
  });

  it('removing or replacing a station drops the line into the next one', () => {
    expect(names(removeEntry(trip(), 2))).not.toContain('Giswil°:via');
    const r = replaceEntry(trip(), 2, s('Arth'));
    expect(entriesOf(r)[2]!.w.name).toBe('Arth');
    expect(names(r).filter((n) => n.includes('°'))).toEqual([]);
  });

  it('sets a stay, a change or riding through on inner stations only', () => {
    expect(setEntryStay(trip(), 2, 60).waypoints[4]).toMatchObject({ kind: 'stop', dwellMin: 60 });
    expect(setEntryStay(trip(), 2, 0).waypoints[4]).toMatchObject({ kind: 'stop', dwellMin: 0 });
    expect(setEntryStay(setEntryStay(trip(), 2, 60), 2, null).waypoints[4]).toMatchObject({
      kind: 'via',
      dwellMin: 0,
    });
    expect(setEntryStay(trip(), 0, 60)).toEqual(trip());
  });

  it('drops a line on request; the same stations make the same key', () => {
    expect(names(dropLine(trip(), 2)).filter((n) => n.includes('°'))).toEqual(['Giswil°:via']);
    expect(routeKey(trip())).toBe(routeKey(structuredClone(trip())));
    expect(routeKey(trip())).not.toBe(routeKey(dropLine(trip(), 2)));
  });

  it('a line switched off leaves no rule behind: its ends lose the template', () => {
    const off = dropLine(trip(), 2);
    expect(off.waypoints.filter((w) => w.templateId === 'vae')).toEqual([]);
    expect(off.waypoints.filter((w) => w.templateId === 'bruenig').length).toBeGreaterThan(0);
  });

  it('does not add the station you are at twice', () => {
    const t = insertEntries(start(), 0, [stationEntry(s('Zurich')), stationEntry(s('Bern'))]);
    expect(entriesOf(t).map((e) => e.w.name)).toEqual(['Zurich', 'Bern']);
  });
});

describe('rows', () => {
  it('shows the route before planning, rings without entries', () => {
    const rows = routeRows(trip());
    expect(
      rows.map((r) => (r.type === 'station' ? `${r.name}:${r.role}:${r.entry ?? 'ring'}` : '')),
    ).toEqual([
      'Zurich:start:0',
      'StGallen:pass:1',
      'Herisau:pass:ring',
      'Wattwil:pass:ring',
      'Luzern:pass:2',
      'Giswil:pass:ring',
      'Interlaken:pass:3',
      'Bern:end:4',
    ]);
  });

  it('lays a planned connection over the route: boarding, passed rings, a change of its own', () => {
    const tour = insertEntries(start(), 0, lineEntries(VAE));
    const call = (n: string, arr?: string, dep?: string) => ({
      stopRef: `ch:1:sloid:${n}`,
      name: n,
      ...(arr ? { arr } : {}),
      ...(dep ? { dep } : {}),
    });
    const iso = (t: string) => `2026-11-07T${t}:00Z`;
    const rows = plannedRows(tour, [
      {
        legIndex: 0,
        dep: iso('07:00'),
        arr: iso('09:00'),
        transfers: 1,
        sections: [
          {
            mode: 'rail',
            line: 'IC1',
            from: call('Zurich', undefined, iso('07:00')),
            to: call('Winterthur', iso('07:20')),
            intermediate: [],
          },
          {
            mode: 'rail',
            line: 'VAE',
            from: call('Winterthur', undefined, iso('07:25')),
            to: call('Luzern', iso('09:00')),
            intermediate: [
              call('StGallen', iso('07:50'), iso('07:52')),
              call('Herisau', iso('08:00'), iso('08:01')),
              call('Wil', iso('08:10'), iso('08:11')),
              call('Wattwil', iso('08:20'), iso('08:21')),
            ],
          },
        ],
      },
    ]);
    expect(
      rows.map((r) =>
        r.type === 'ride'
          ? `[${r.section.line}]`
          : `${r.name}:${r.role}:${r.entry ?? (r.ring ? 'ring' : '-')}`,
      ),
    ).toEqual([
      'Zurich:start:0',
      '[IC1]',
      'Winterthur:change:-',
      '[VAE]',
      'StGallen:pass:1',
      'Herisau:pass:ring',
      'Wattwil:pass:ring',
      'Luzern:end:2',
    ]);
  });
});

describe('rows: what the plan does not reach, and walks under a minute', () => {
  const iso = (t: string) => `2026-11-07T${t}:00Z`;
  const call = (n: string, arr?: string, dep?: string) => ({
    stopRef: `ch:1:sloid:${n}`,
    name: n,
    ...(arr ? { arr: iso(arr) } : {}),
    ...(dep ? { dep: iso(dep) } : {}),
  });
  const label = (r: ReturnType<typeof plannedRows>[number]) =>
    r.type === 'ride'
      ? `[${r.section.line ?? r.section.mode}]`
      : `${r.name}${r.missed ? ' (missed)' : ''}`;

  it('keeps a line station the train does not pass, marked as missed', () => {
    const tour = insertEntries(start(), 0, lineEntries(VAE));
    const rows = plannedRows(tour, [
      {
        legIndex: 0,
        dep: iso('07:00'),
        arr: iso('09:00'),
        transfers: 0,
        sections: [
          {
            mode: 'rail',
            line: 'IR',
            from: call('Zurich', undefined, '07:00'),
            to: call('Luzern', '09:00'),
            intermediate: [call('StGallen', '07:50', '07:52'), call('Wattwil', '08:20', '08:21')],
          },
        ],
      },
    ]);
    expect(rows.map(label)).toEqual([
      'Zurich',
      '[IR]',
      'StGallen',
      'Herisau (missed)',
      'Wattwil',
      'Luzern',
    ]);
  });

  it('merges the two ends of a walk under a minute into one station', () => {
    const tour = insertEntries(start(), 0, [stationEntry(s('Muerren'))]);
    const rows = plannedRows(tour, [
      {
        legIndex: 0,
        dep: iso('07:00'),
        arr: iso('08:00'),
        transfers: 1,
        sections: [
          {
            mode: 'rail',
            line: 'R62',
            from: call('Zurich', undefined, '07:00'),
            to: call('Lauterbrunnen', '07:30'),
            intermediate: [],
          },
          {
            mode: 'walk',
            from: call('Lauterbrunnen'),
            to: call('LauterbrunnenSeilbahn'),
            intermediate: [],
          },
          {
            mode: 'cableCar',
            line: 'PB',
            from: call('LauterbrunnenSeilbahn', undefined, '07:40'),
            to: call('Muerren', '08:00'),
            intermediate: [],
          },
        ],
      },
    ]);
    expect(rows.map(label)).toEqual(['Zurich', '[R62]', 'Lauterbrunnen', '[PB]', 'Muerren']);
    // A route that names the other stop matches the merged row, not a station missed.
    const viaSeilbahn = insertEntries(start(), 0, [
      stationEntry(s('LauterbrunnenSeilbahn')),
      stationEntry(s('Muerren')),
    ]);
    const rows2 = plannedRows(viaSeilbahn, [
      {
        legIndex: 0,
        dep: iso('07:00'),
        arr: iso('08:00'),
        transfers: 1,
        sections: [
          {
            mode: 'rail',
            line: 'R62',
            from: call('Zurich', undefined, '07:00'),
            to: call('Lauterbrunnen', '07:30'),
            intermediate: [],
          },
          {
            mode: 'walk',
            from: call('Lauterbrunnen'),
            to: call('LauterbrunnenSeilbahn'),
            intermediate: [],
          },
          {
            mode: 'cableCar',
            line: 'PB',
            from: call('LauterbrunnenSeilbahn', undefined, '07:40'),
            to: call('Muerren', '08:00'),
            intermediate: [],
          },
        ],
      },
    ]);
    expect(rows2.map(label)).not.toContain('LauterbrunnenSeilbahn (missed)');
    const at = rows[2]!;
    expect(at.type === 'station' && [at.arr, at.dep]).toEqual([iso('07:30'), iso('07:40')]);
  });
});

describe('rows: the replacement bus outside the station', () => {
  const iso = (t: string) => `2026-11-07T${t}:00Z`;
  const call = (n: string, arr?: string, dep?: string) => ({
    stopRef: `ch:1:sloid:${n}`,
    name: n,
    ...(arr ? { arr: iso(arr) } : {}),
    ...(dep ? { dep: iso(dep) } : {}),
  });

  it('counts the station walked through from the bus stop outside it, not as a station missed', () => {
    const tour = insertEntries(start(), 0, [
      stationEntry(s('Interlaken Ost')),
      stationEntry(s('Bern')),
    ]);
    const rows = plannedRows(tour, [
      {
        legIndex: 0,
        dep: iso('07:00'),
        arr: iso('09:00'),
        transfers: 1,
        sections: [
          {
            mode: 'bus',
            line: 'EV',
            from: call('Zurich', undefined, '07:00'),
            to: call('Interlaken Ost, Bahnhof', '08:00'),
            intermediate: [],
          },
          {
            mode: 'walk',
            walkMin: 0,
            from: call('Interlaken Ost, Bahnhof'),
            to: call('Interlaken Ost'),
            intermediate: [],
          },
          {
            mode: 'rail',
            line: 'IC',
            from: call('Interlaken Ost', undefined, '08:10'),
            to: call('Bern', '09:00'),
            intermediate: [],
          },
        ],
      },
    ]);
    const names = rows.flatMap((r) =>
      r.type === 'station' ? [`${r.name}${r.missed ? ' (missed)' : ''}`] : [],
    );
    expect(names).toEqual(['Zurich', 'Interlaken Ost', 'Bern']);
  });
});

describe('a finished trip waits in search', () => {
  const chain = (day: string) => ({
    connections: [],
    warnings: [],
    score: 0,
    dep: `${day}T08:00:00Z`,
    arr: `${day}T18:00:00Z`,
  });
  const tripOn = (id: string, day: string, route = trip()) =>
    newTrip(id, { ...route, id: 'r', date: day, name: id } as Tour, [], chain(day), new Date(0));

  it('moves past trips into your trips, newest first, the same stations once', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const r = retire(
      [tripOn('a', '2026-11-01'), tripOn('b', '2026-11-07'), tripOn('c', '2026-11-20')],
      [{ ...trip(), id: 'old', name: 'old', date: '2026-10-01' } as Tour],
      now,
    );
    expect(r.changed).toBe(true);
    expect(r.trips.map((t) => t.id)).toEqual(['c']);
    expect(r.tours.map((t) => t.name)).toEqual(['b']);
  });

  it('gives a retired trip the same id on every device, and counts days in Zurich', () => {
    const r = retire([tripOn('a', '2026-11-01')], [], Date.parse('2026-11-03T12:00:00Z'));
    expect(r.tours[0]!.id).toBe('past-a');
    // 23:30 in Zurich on the 7th is already the 8th in UTC: the trip of the 7th is not over yet.
    expect(dayOf(Date.parse('2026-11-07T22:30:00Z'))).toBe('2026-11-07');
    expect(zurichTime('2026-11-07', '08:00')).toBe(Date.parse('2026-11-07T07:00:00Z'));
    expect(zurichTime('2026-07-04', '08:00')).toBe(Date.parse('2026-07-04T06:00:00Z'));
  });

  it('puts the newest past trip first when the routes differ', () => {
    const other = insertEntries(start(), 0, [stationEntry(s('Bern'))]);
    const r = retire(
      [tripOn('older', '2026-11-01', other), tripOn('newer', '2026-11-07')],
      [],
      Date.parse('2026-11-10T12:00:00Z'),
    );
    expect(r.tours.map((t) => t.name)).toEqual(['newer', 'older']);
  });

  it('keeps a trip whose last train runs late past midnight, until it has arrived', () => {
    const t = tripOn('late', '2026-11-07');
    // Planned to arrive 18:00Z on the 7th; live data says 00:20 Zurich on the 8th.
    const late = Date.parse('2026-11-07T23:20:00Z');
    const at = Date.parse('2026-11-07T23:10:00Z'); // 00:10 on the 8th in Zurich
    expect(retire([t], [], at, () => late).changed).toBe(false);
    expect(retire([t], [], late + 60 * 60_000, () => late).changed).toBe(true);
  });

  it('drops a past trip of a single station without keeping it', () => {
    const one = tripOn('one', '2026-11-01', start());
    const r = retire([one], [], Date.parse('2026-11-10T12:00:00Z'));
    expect(r.trips).toEqual([]);
    expect(r.tours).toEqual([]);
  });

  it('retires a trip never planned once its day is over, and nothing early', () => {
    const draft = newTrip(
      'd',
      { ...trip(), id: 'r', date: '2026-11-07', name: 'd' } as Tour,
      undefined,
      undefined,
      new Date(0),
    );
    expect(retire([draft], [], Date.parse('2026-11-07T20:00:00Z')).changed).toBe(false);
    expect(retire([draft], [], Date.parse('2026-11-08T08:00:00Z')).tours).toHaveLength(1);
  });
});
