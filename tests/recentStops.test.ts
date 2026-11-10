// Stations you entered lately (0.48.0): newest first, each once, then your trips' own stations.
import { describe, expect, it } from 'vitest';
import type { Waypoint } from '../src/core/model';
import { mergeRecent, RECENT_MAX, recentStations, remember } from '../src/core/recentStops';

const IDS: Record<string, number> = {
  Bern: 7000,
  Thun: 7008,
  Chur: 9000,
  Zürich: 3000,
  Tirano: 8392,
  Filisur: 9010,
};
let next = 1;
const id = (n: string) => (IDS[n] ??= 100000 + next++);
const s = (n: string) => ({ stopRef: `ch:1:sloid:${id(n)}`, name: n });
const w = (n: string, ring = false): Waypoint => ({
  ...s(n),
  kind: 'via',
  dwellMin: 0,
  ...(ring ? { ring: true } : {}),
});

describe('recent stations', () => {
  it('remembers the newest first, each once, at most RECENT_MAX', () => {
    let list = remember([], [s('Bern'), s('Thun')], 100);
    expect(list.map((x) => x.name)).toEqual(['Thun', 'Bern']);
    list = remember(list, [s('Bern')], 200);
    expect(list.map((x) => x.name)).toEqual(['Bern', 'Thun']);
    // A bus stand's quay is the same station.
    list = remember(list, [{ stopRef: 'ch:1:sloid:7008:1:2', name: 'Thun' }], 300);
    expect(list.map((x) => x.name)).toEqual(['Thun', 'Bern']);
    const many = Array.from({ length: RECENT_MAX + 5 }, (_, i) => s(`S${i}`));
    expect(remember([], many, 400)).toHaveLength(RECENT_MAX);
  });

  it('merges two devices’ lists by station, the later pick winning, the same either way', () => {
    const a = [
      { ...s('Bern'), at: 5 },
      { ...s('Thun'), at: 1 },
    ];
    const b = [
      { ...s('Thun'), at: 9 },
      { ...s('Chur'), at: 3 },
    ];
    expect(mergeRecent(a, b).map((x) => x.name)).toEqual(['Thun', 'Bern', 'Chur']);
    expect(mergeRecent(b, a)).toEqual(mergeRecent(a, b));
    // Kept before sync, without a time: the oldest.
    expect(mergeRecent([s('Zürich')], a).map((x) => x.name)).toEqual(['Bern', 'Thun', 'Zürich']);
  });

  it('offers those entered, then your trips’ own stations, never the ones beside', () => {
    const got = recentStations(
      [s('Chur')],
      [[w('Zürich'), w('Filisur', true), w('Chur'), w('Tirano')]],
      [s('Zürich').stopRef],
    );
    expect(got.map((x) => x.name)).toEqual(['Chur', 'Tirano']);
  });
});
