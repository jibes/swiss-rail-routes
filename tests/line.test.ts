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
import { dayOf, newTrip, otherDay, zurichTime } from '../src/core/trip';
import { pastRoutes, tripsFromTours } from '../src/core/pastTrips';
import {
  missedByDisruption,
  plannedRows,
  routeRows,
  viasOnRides,
  type RideRow,
} from '../src/core/rows';
import type { Warning } from '../src/core/warnings';

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

  it('a station moved into a line’s gap ends the line for good', () => {
    let t = insertEntries(start(), 0, lineEntries(LAKE));
    t = insertEntries(t, 2, [stationEntry(s('Bern'))]);
    // Zurich, Vitznau, Luzern (lake), Bern → Bern between Vitznau and Luzern.
    const moved = moveEntry(t, 3, 2);
    expect(entriesOf(moved).map((e) => e.w.name)).toEqual(['Zurich', 'Vitznau', 'Bern', 'Luzern']);
    expect(entriesOf(moved).map((_, k, e) => lineTo(e, k))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // Taking Bern out again does not bring the line back.
    expect(entriesOf(removeEntry(moved, 2)).some((_, k, e) => lineTo(e, k))).toBe(false);
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

  const voralpen = () =>
    plannedRows(
      insertEntries(start(), 0, [
        stationEntry(s('Wattwil')),
        stationEntry(s('Biberbrugg')),
        stationEntry(s('Luzern')),
      ]),
      [
        {
          legIndex: 0,
          dep: iso('12:05'),
          arr: iso('14:21'),
          transfers: 0,
          sections: [
            {
              mode: 'rail',
              line: 'VAE',
              from: call('Zurich', undefined, '12:05'),
              to: call('Luzern', '14:21'),
              intermediate: [
                call('Herisau', '12:13', '12:14'),
                call('Wattwil', '12:32', '12:33'),
                call('Uznach', '12:43', '12:44'),
                call('Biberbrugg', '13:20', '13:21'),
              ],
            },
          ],
        },
      ],
    );

  it('puts a route station on the ride among its stops, at its own place', () => {
    const rows = voralpen();
    expect(rows.map(label)).toEqual(['Zurich', '[VAE]', 'Wattwil', 'Biberbrugg', 'Luzern']);
    expect(viasOnRides(rows)).toEqual(
      new Map([
        [
          1,
          [
            { row: 2, call: 1 },
            { row: 3, call: 3 },
          ],
        ],
      ]),
    );
  });

  it('leaves a station where you change, and one missed, on the line', () => {
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
    // StGallen, Herisau (missed), Wattwil: the missed one stays a row of its own.
    expect(rows.map(label)[3]).toBe('Herisau (missed)');
    expect(viasOnRides(rows).get(1)).toEqual([
      { row: 2, call: 0 },
      { row: 4, call: 1 },
    ]);
  });

  it('blames a disruption for a missed station only when it is on a ride beside it', () => {
    const tour = insertEntries(start(), 0, lineEntries(VAE));
    const ride = (line: string, a: string, b: string) => ({
      mode: 'rail' as const,
      line,
      from: call(a, undefined, '07:00'),
      to: call(b, '08:00'),
      intermediate: [],
    });
    const rows = plannedRows(tour, [
      {
        legIndex: 0,
        dep: iso('07:00'),
        arr: iso('10:00'),
        transfers: 2,
        sections: [
          ride('A', 'Zurich', 'Wil'),
          ride('B', 'Wil', 'Luzern'),
          ride('C', 'Luzern', 'Bern'),
        ],
      },
    ]);
    const i = rows.findIndex((r) => r.type === 'station' && r.missed);
    const on = (sectionIndex: number): Warning[] => [
      {
        type: 'disruption',
        severity: 'warn',
        legIndex: 0,
        sectionIndex,
        key: 'wDisruption',
        params: {},
      },
    ];
    expect(i).toBeGreaterThan(0);
    const before = rows.slice(0, i).findLast((r) => r.type === 'ride') as RideRow;
    expect(missedByDisruption(rows, i, on(before.sectionIndex))).toBe(true);
    expect(missedByDisruption(rows, i, on(99))).toBe(false);
    expect(missedByDisruption(rows, i, [])).toBe(false);
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

  it('a walk from the bus stop to the station and back is the stop, arriving and leaving', () => {
    // T1 on the Albula closure: the bus passes Bergün by walking from "Bergün, posta" to the
    // station and back while you wait for the next bus. One row, with both times.
    const tour = insertEntries(start(), 0, [
      stationEntry(s('Bergün/Bravuogn')),
      stationEntry(s('Preda')),
    ]);
    const walk = (a: string, b: string) => ({
      mode: 'walk' as const,
      walkMin: 8,
      from: call(a),
      to: call(b),
      intermediate: [],
    });
    const rows = plannedRows(tour, [
      {
        legIndex: 0,
        dep: iso('11:58'),
        arr: iso('13:30'),
        transfers: 1,
        sections: [
          {
            mode: 'bus',
            line: 'EV4',
            from: call('Zurich', undefined, '11:58'),
            to: call('Bergün/Bravuogn, posta', '12:17'),
            intermediate: [],
          },
          walk('Bergün/Bravuogn, posta', 'Bergün/Bravuogn'),
          walk('Bergün/Bravuogn', 'Bergün/Bravuogn, posta'),
          {
            mode: 'bus',
            line: 'EV4',
            from: call('Bergün/Bravuogn, posta', undefined, '13:17'),
            to: call('Preda', '13:30'),
            intermediate: [],
          },
        ],
      },
    ]);
    expect(rows.map((r) => (r.type === 'ride' ? `[${r.section.mode}]` : r.name))).toEqual([
      'Zurich',
      '[bus]',
      'Bergün/Bravuogn',
      '[bus]',
      'Preda',
    ]);
    const bergün = rows[2] as Extract<(typeof rows)[number], { type: 'station' }>;
    expect([bergün.arr, bergün.dep, bergün.role, bergün.missed]).toEqual([
      iso('12:17'),
      iso('13:17'),
      'change',
      undefined,
    ]);
  });

  it('a link holds only the trains: a route station not among their ends is not missed', () => {
    const tour = insertEntries(start(), 0, [
      stationEntry(s('Pontresina')),
      stationEntry(s('Tirano')),
    ]);
    const chain = [
      {
        legIndex: 0,
        dep: iso('09:00'),
        arr: iso('11:00'),
        transfers: 0,
        sections: [
          {
            mode: 'rail' as const,
            line: 'R',
            from: call('Zurich', undefined, '09:00'),
            to: call('Tirano', '11:00'),
            intermediate: [],
          },
        ],
      },
    ];
    const missed = (rows: ReturnType<typeof plannedRows>) =>
      rows.flatMap((r) => (r.type === 'station' && r.missed ? [r.name] : []));
    expect(missed(plannedRows(tour, chain))).toEqual(['Pontresina']);
    expect(missed(plannedRows(tour, chain, { partial: true }))).toEqual([]);
    // Still on the line, in its place, without times.
    expect(
      plannedRows(tour, chain, { partial: true }).map((r) => (r.type === 'station' ? r.name : '-')),
    ).toEqual(['Zurich', '-', 'Pontresina', 'Tirano']);
  });
});

describe('past trips stay trips (0.52.0)', () => {
  const chain = (day: string) => ({
    connections: [],
    warnings: [],
    score: 0,
    dep: `${day}T08:00:00Z`,
    arr: `${day}T18:00:00Z`,
  });
  const tripOn = (id: string, day: string, route = trip()) =>
    newTrip(id, { ...route, id: 'r', date: day, name: id } as Tour, [], chain(day), new Date(0));

  it('offers past trips’ routes newest first, the same stations once, none ahead', () => {
    const other = insertEntries(start(), 0, [stationEntry(s('Bern'))]);
    const now = Date.parse('2026-11-10T12:00:00Z');
    const r = pastRoutes(
      [
        tripOn('a', '2026-11-01'),
        tripOn('b', '2026-11-07'),
        tripOn('older', '2026-10-01', other),
        tripOn('c', '2026-11-20'),
        tripOn('one', '2026-11-02', start()),
      ],
      now,
    );
    expect(r.map((t) => t.name)).toEqual(['b', 'older']);
    expect(r[0]!.id).toBe('b');
  });

  it('brings the routes kept before back as trips, once, by their own id', () => {
    const tour = { ...trip(), id: 'past-x', name: 'x', date: '2026-10-01' } as Tour;
    const back = tripsFromTours([tour], [], new Date(0));
    expect(back.map((t) => [t.id, t.route.date, !!t.chain])).toEqual([
      ['past-x', '2026-10-01', false],
    ]);
    expect(tripsFromTours([tour], back, new Date(0))).toEqual([]);
    // 23:30 in Zurich on the 7th is already the 8th in UTC: days are counted in Zurich.
    expect(dayOf(Date.parse('2026-11-07T22:30:00Z'))).toBe('2026-11-07');
    expect(zurichTime('2026-11-07', '08:00')).toBe(Date.parse('2026-11-07T07:00:00Z'));
    expect(zurichTime('2026-07-04', '08:00')).toBe(Date.parse('2026-07-04T06:00:00Z'));
  });

  it('an option on another day than the trip’s says its day (reported: three 14:48 alike)', () => {
    expect(otherDay('2026-12-27T13:48:00Z', '2026-12-27')).toBeUndefined();
    expect(otherDay('2026-12-28T13:48:00Z', '2026-12-27')).toBe('2026-12-28');
    expect(otherDay('2026-12-27T23:30:00Z', '2026-12-27')).toBe('2026-12-28');
  });
});

describe('a station the plan chose, made yours (pinAfter)', async () => {
  const { pinAfter } = await import('../src/core/rows');
  const st = (name: string, entry?: number, ring?: boolean) =>
    ({ type: 'station', name, key: name, role: 'change', entry, ring }) as const;
  const ride = { type: 'ride' } as never;
  const entries = [{ w: {} }, { w: {} }, { w: { line: 'bernina' } }];

  it('after the last of yours before it; never before your first, after your last, in a line', () => {
    const rows = [st('A', 0), ride, st('X'), ride, st('B', 1), ride, st('Y'), ride, st('C', 2)];
    expect(pinAfter(rows as never, 2, entries)).toBe(0);
    // Between B and C runs a scenic line: its way is the line's.
    expect(pinAfter(rows as never, 6, entries)).toBeUndefined();
    expect(pinAfter(rows as never, 0, entries)).toBeUndefined();
    // A ride's own stops: after the entry before the ride.
    expect(pinAfter(rows as never, 1, entries)).toBe(0);
    expect(pinAfter([st('Z'), ...rows] as never, 0, entries)).toBeUndefined();
    expect(pinAfter([st('R', undefined, true)] as never, 0, entries)).toBeUndefined();
  });
});
