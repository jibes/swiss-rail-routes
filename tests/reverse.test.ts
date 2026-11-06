// The route the other way round (⋯ → Reverse direction): stations, lines and stays.
import { describe, expect, it } from 'vitest';
import { newTour } from './helpers/edit';
import {
  entriesOf,
  insertEntries,
  lineEntries,
  linesOf,
  reverseRoute,
  setEntryLeaveBy,
  setEntryStay,
  stationEntry,
} from '../src/core/line';
import type { Tour } from '../src/core/model';

const s = (name: string) => ({ stopRef: `ch:1:sloid:${name}`, name });
const ALBULA = {
  id: 'albula',
  chain: ['Chur', 'Thusis', 'Filisur', 'Bergun', 'Preda', 'StMoritz'].map((n) => ({
    ref: `ch:1:sloid:${n}`,
    name: n,
  })),
  mustPass: ['ch:1:sloid:Thusis', 'ch:1:sloid:Filisur', 'ch:1:sloid:Bergun', 'ch:1:sloid:Preda'],
};
const names = (t: Pick<Tour, 'waypoints'>) =>
  t.waypoints.map((w) => `${w.name}${w.ring ? '°' : ''}:${w.kind}${w.dwellMin ? w.dwellMin : ''}`);
const stations = (...list: string[]) =>
  insertEntries(
    newTour('t', '2026-11-07'),
    -1,
    list.map((n) => stationEntry(s(n))),
  );

describe('reverse direction', () => {
  it('an open route runs from its end, stays with their stations', () => {
    const t = setEntryStay(stations('A', 'B', 'C', 'D'), 1, 30);
    const { tour, windowsDropped } = reverseRoute(t);
    expect(names(tour)).toEqual(['D:start', 'C:via', 'B:stop30', 'A:end']);
    expect(windowsDropped).toBe(false);
  });

  it('a round trip keeps its start and runs the loop the other way', () => {
    const t = setEntryStay(stations('A', 'B', 'C', 'A'), 2, 60);
    expect(names(reverseRoute(t).tour)).toEqual(['A:start', 'C:stop60', 'B:via', 'A:end']);
  });

  it('a line runs the other way, on its new end, its stations reversed', () => {
    // Zürich → Albula (Chur … St. Moritz) → Tirano.
    let t = stations('Zurich');
    t = insertEntries(t, 0, [stationEntry(s('Chur'))]);
    t = insertEntries(t, 1, lineEntries(ALBULA));
    t = insertEntries(t, 2, [stationEntry(s('Tirano'))]);
    expect(names(t)).toEqual([
      'Zurich:start',
      'Chur:via',
      'Thusis°:via',
      'Filisur°:via',
      'Bergun°:via',
      'Preda°:via',
      'StMoritz:via',
      'Tirano:end',
    ]);
    const back = reverseRoute(t).tour;
    expect(names(back)).toEqual([
      'Tirano:start',
      'StMoritz:via',
      'Preda°:via',
      'Bergun°:via',
      'Filisur°:via',
      'Thusis°:via',
      'Chur:via',
      'Zurich:end',
    ]);
    // The line leads to Chur now, from St. Moritz.
    const e = entriesOf(back);
    expect(e.map((x) => x.w.line ?? '')).toEqual(['', '', 'albula', '']);
    expect(linesOf(back.waypoints)).toEqual(new Set(['albula']));
  });

  it('a round trip with a line: the loop the other way, the line too', () => {
    let t = stations('Chur');
    t = insertEntries(t, 0, lineEntries(ALBULA));
    t = insertEntries(t, 1, [stationEntry(s('Klosters')), stationEntry(s('Chur'))]);
    const back = reverseRoute(t).tour;
    expect(names(back)).toEqual([
      'Chur:start',
      'Klosters:via',
      'StMoritz:via',
      'Preda°:via',
      'Bergun°:via',
      'Filisur°:via',
      'Thusis°:via',
      'Chur:end',
    ]);
  });

  it('twice is the route it was', () => {
    let t = stations('Zurich');
    t = insertEntries(t, 0, [stationEntry(s('Chur'))]);
    t = insertEntries(t, 1, lineEntries(ALBULA));
    t = insertEntries(t, 2, [stationEntry(s('Tirano')), stationEntry(s('Zurich'))]);
    t = setEntryStay(t, 3, 90);
    const twice = reverseRoute(reverseRoute(t).tour).tour;
    expect(twice.waypoints).toEqual(t.waypoints);
    const open = setEntryStay(stations('A', 'B', 'C'), 1, 15);
    expect(reverseRoute(reverseRoute(open).tour).tour.waypoints).toEqual(open.waypoints);
  });

  it('a stay’s window goes, and says so', () => {
    const t = setEntryLeaveBy(setEntryStay(stations('A', 'B', 'C'), 1, 30), 1, '17:30');
    const { tour, windowsDropped } = reverseRoute(t);
    expect(windowsDropped).toBe(true);
    expect(tour.waypoints.some((w) => w.leaveBy || w.arriveAfter)).toBe(false);
    expect(names(tour)).toEqual(['C:start', 'B:stop30', 'A:end']);
  });
});
