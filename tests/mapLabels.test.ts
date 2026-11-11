import { describe, expect, it } from 'vitest';
import { boxAt, mapName, placeLabels } from '../src/core/mapLabels';

describe('map names kept apart', () => {
  const at = (x: number, y: number) => ({ x, y, w: 60, h: 14 });

  it('puts a name below its dot, else beside it, never over one placed before', () => {
    // The second's dot lies under the first's name: below and beside it would touch it; above
    // is free.
    expect(placeLabels([at(0, 0), at(20, 5)])).toEqual(['below', 'above']);
    // A name boxed in on every side is hidden.
    const crowd = [at(0, 0), at(0, 23), at(69, 0), at(-69, 0), at(0, -23)];
    expect(placeLabels([...crowd, at(0, 0)]).at(-1)).toBeNull();
    // A gap counts: 2 px apart is too close, so the second goes elsewhere.
    expect(placeLabels([at(0, 0), at(62, 0)])).toEqual(['below', 'right']);
  });

  it('keeps a name off the route’s line and the weather’s icons where it can', () => {
    // The line runs down through the station: below and above cross it; right is free.
    const line: [number, number][] = [
      [0, -100],
      [0, 100],
    ];
    expect(placeLabels([at(0, 0)], { boxes: [], lines: [line] })).toEqual(['right']);
    // A sky icon right of it too: left.
    const sky = { x: 8, y: -16, w: 32, h: 24 };
    expect(placeLabels([at(0, 0)], { boxes: [sky], lines: [line] })).toEqual(['left']);
    // Covered wherever it goes: the side covering least, still shown.
    const all = [sky, { x: -60, y: -16, w: 50, h: 24 }];
    expect(placeLabels([at(0, 0)], { boxes: all, lines: [line] })).toEqual(['below']);
  });

  it('places each side clear of its own dot', () => {
    const l = at(100, 100);
    expect(boxAt(l, 'below')).toEqual({ x: 70, y: 109, w: 60, h: 14 });
    expect(boxAt(l, 'above')).toEqual({ x: 70, y: 77, w: 60, h: 14 });
    expect(boxAt(l, 'right')).toEqual({ x: 109, y: 93, w: 60, h: 14 });
    expect(boxAt(l, 'left')).toEqual({ x: 31, y: 93, w: 60, h: 14 });
  });

  it('leaves a stop’s “Bahnhof” off, nothing else', () => {
    expect(mapName('Thusis, Bahnhof')).toBe('Thusis');
    expect(mapName('Preda, Stazion')).toBe('Preda');
    expect(mapName('Bergün/Bravuogn, posta')).toBe('Bergün/Bravuogn, posta');
    expect(mapName('Zürich HB')).toBe('Zürich HB');
  });
});
