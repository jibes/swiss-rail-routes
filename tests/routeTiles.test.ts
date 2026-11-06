import { describe, expect, it } from 'vitest';
import { KEEP_MAX, tilesAlong, tileUrl } from '../src/core/routeTiles';

// Chur → St. Moritz as a straight line (the trip's lines are its tracks; the rule is the same).
const CHUR: [number, number] = [9.5296, 46.8535];
const ST_MORITZ: [number, number] = [9.8459, 46.4983];

describe('the map along a trip, for offline (0.34.0)', () => {
  const tiles = tilesAlong([[CHUR, ST_MORITZ]]);

  it('the tiles under the line and one either side, coarse first', () => {
    expect(tiles[0]!.z).toBe(10);
    expect(tiles.map((t) => t.z)).toEqual([...tiles.map((t) => t.z)].sort((a, b) => a - b));
    // Chur at zoom 10 (x 539, y 360 by the Web Mercator formula) and its neighbours.
    const z10 = tiles.filter((t) => t.z === 10).map((t) => `${t.x}/${t.y}`);
    expect(z10).toEqual(expect.arrayContaining(['539/360', '538/359', '540/361']));
    // Every zoom 13 tile is within one of the line's own.
    expect(tiles.some((t) => t.z === 13)).toBe(true);
    expect(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(tiles.length);
  });

  it('never more than the cap, so the map as seen is not all pushed out', () => {
    const far = tilesAlong([
      [
        [6.1, 46.2],
        [10.4, 47.5],
      ],
    ]);
    expect(far.length).toBe(KEEP_MAX);
    expect(tiles.length).toBeLessThan(KEEP_MAX);
  });

  it('addressed by the TileJSON’s template', () => {
    expect(tileUrl('https://t/planet/x/{z}/{x}/{y}.pbf', { z: 10, x: 539, y: 360 })).toBe(
      'https://t/planet/x/10/539/360.pbf',
    );
  });
});
