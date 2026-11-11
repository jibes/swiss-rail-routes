import { describe, expect, it } from 'vitest';
import { mapName, placeLabels } from '../src/core/mapLabels';

describe('map names kept apart', () => {
  it('shows the first wanted, hides any lying over one shown', () => {
    const at = (x: number, y: number) => ({ x, y, w: 60, h: 14 });
    expect(placeLabels([at(0, 0), at(30, 5), at(100, 0), at(0, 40)])).toEqual([
      true,
      false,
      true,
      true,
    ]);
    // A gap counts: 2 px apart is too close.
    expect(placeLabels([at(0, 0), at(62, 0)])).toEqual([true, false]);
  });

  it('leaves a stop’s “Bahnhof” off, nothing else', () => {
    expect(mapName('Thusis, Bahnhof')).toBe('Thusis');
    expect(mapName('Preda, Stazion')).toBe('Preda');
    expect(mapName('Bergün/Bravuogn, posta')).toBe('Bergün/Bravuogn, posta');
    expect(mapName('Zürich HB')).toBe('Zürich HB');
  });
});
