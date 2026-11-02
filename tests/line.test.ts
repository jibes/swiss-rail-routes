import { describe, expect, it } from 'vitest';
import { insertTemplate, newTour } from '../src/core/edit';
import {
  dropLine,
  entriesOf,
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
import { newTrip } from '../src/core/trip';
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
  let n = 0;
  const ids = () => `x${++n}`;

  it('moves past trips into your trips, newest first, the same stations once', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const r = retire(
      [tripOn('a', '2026-11-01'), tripOn('b', '2026-11-07'), tripOn('c', '2026-11-20')],
      [{ ...trip(), id: 'old', name: 'old', date: '2026-10-01' } as Tour],
      now,
      ids,
    );
    expect(r.changed).toBe(true);
    expect(r.trips.map((t) => t.id)).toEqual(['c']);
    expect(r.tours.map((t) => t.name)).toEqual(['b']);
  });

  it('retires a trip never planned once its day is over, and nothing early', () => {
    const draft = newTrip(
      'd',
      { ...trip(), id: 'r', date: '2026-11-07', name: 'd' } as Tour,
      undefined,
      undefined,
      new Date(0),
    );
    expect(retire([draft], [], Date.parse('2026-11-07T22:00:00'), ids).changed).toBe(false);
    expect(retire([draft], [], Date.parse('2026-11-08T08:00:00'), ids).tours).toHaveLength(1);
  });
});
