import { describe, expect, it } from 'vitest';
import { liveState } from '../src/core/live';
import type { LatLon } from '../src/core/model';
import { zurichDateTime } from '../src/core/ojp/request';
import {
  FIX_ROUGH_M,
  FIX_STALE_MS,
  accuracyArea,
  estimatedPosition,
  shownPosition,
  type Fix,
} from '../src/core/position';
import { stopKey } from '../src/core/stops';
import { DATE, conn, index, ref, ride } from './helpers/timetable';

const at = (hhmm: string) => Date.parse(zurichDateTime(`${DATE}T${hhmm}`));
const stop = (key: string) => index.byRef(key);
const coords = (name: string): [number, number] => {
  const p = index.byRef(ref(name))!;
  return [p.lon, p.lat];
};
const near = (a: [number, number], b: [number, number], deg = 0.002) => {
  expect(Math.abs(a[0] - b[0])).toBeLessThan(deg);
  expect(Math.abs(a[1] - b[1])).toBeLessThan(deg);
};

// Zürich 08:04 → Zug 08:25 (dep 08:27) → Luzern 08:45; Luzern 08:51 → Interlaken Ost 10:41.
const first = ride('IR 70', [
  ['Zürich HB', '08:04'],
  ['Zug', '08:25'],
  ['Luzern', '08:45'],
]);
const second = ride('PE LIX', [
  ['Luzern', '08:51'],
  ['Interlaken Ost', '10:41'],
]);
const chain = [conn(first, second)];
const estimate = (now: number, c = chain) => estimatedPosition(liveState(c, now), stop);

describe('estimatedPosition', () => {
  it('nothing before the first train or after the last', () => {
    expect(estimate(at('07:50'))).toBeNull();
    expect(estimate(at('11:00'))).toBeNull();
  });

  it('with no geometry: straight between the two stops, by the time', () => {
    const e = estimate(at('08:14') + 30_000)!;
    expect(e).toMatchObject({ kind: 'riding', from: 'Zürich HB', to: 'Zug' });
    const [a, b] = [coords('Zürich HB'), coords('Zug')];
    near(e.pos, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  });

  it('at a change: at the station of the next train', () => {
    const e = estimate(at('08:47'))!;
    expect(e).toMatchObject({ kind: 'waiting', at: 'Luzern' });
    near(e.pos, coords('Luzern'));
  });

  it('a stop it does not know: the nearest known stop, nothing between', () => {
    const unknownZug = (key: string): LatLon | undefined =>
      key === stopKey(ref('Zug')) ? undefined : stop(key);
    const e = estimatedPosition(liveState(chain, at('08:14')), unknownZug)!;
    near(e.pos, coords('Zürich HB'));
    expect(estimatedPosition(liveState(chain, at('08:14')), () => undefined)).toBeNull();
    expect(estimatedPosition(liveState(chain, at('08:47')), () => undefined)).toBeNull();
  });

  const [zh, zug, lu] = [coords('Zürich HB'), coords('Zug'), coords('Luzern')];

  it('follows the track: half the time, half the distance along it', () => {
    // Out to the east by a detour and back: the track's middle is far from the straight line.
    const bend: [number, number] = [(zh[0] + zug[0]) / 2 + 0.2, (zh[1] + zug[1]) / 2];
    const curved = [
      conn(
        ride(
          'IR 70',
          [
            ['Zürich HB', '08:04'],
            ['Zug', '08:24'],
            ['Luzern', '08:45'],
          ],
          { geometry: [zh, bend, zug, lu] },
        ),
      ),
    ];
    const e = estimate(at('08:14'), curved)!;
    near(e.pos, bend, 0.01);
  });

  const rideThrough = (geometry: [number, number][]) => [
    conn(
      ride(
        'IR 70',
        [
          ['Zürich HB', '08:04'],
          ['Zug', '08:24'],
          ['Luzern', '08:44'],
        ],
        { geometry },
      ),
    ),
  ];
  const middle = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];

  it('a track that passes a later stop early: each stop is found after the one before', () => {
    // Past Luzern on the way to Zug: the nearest point to Luzern lies before Zug, the stop does not.
    const c = rideThrough([zh, lu, zug, lu]);
    near(estimate(at('08:34'), c)!.pos, middle(zug, lu), 0.005);
  });

  it('a spiral past a stop twice: the first time it comes near', () => {
    // 50 m from Zug, away to the east and back exactly onto Zug: the first pass is the stop.
    const pass: [number, number] = [zug[0], zug[1] + 50 / 111_320];
    const c = rideThrough([zh, pass, [zug[0] + 0.3, zug[1]], zug, lu]);
    near(estimate(at('08:14'), c)!.pos, middle(zh, pass), 0.005);
  });

  it('a track far from its stops is not trusted: straight', () => {
    const away: [number, number][] = [
      [6, 46],
      [6.1, 46.1],
    ];
    const c = [
      conn(
        ride(
          'IR 70',
          [
            ['Zürich HB', '08:04'],
            ['Zug', '08:24'],
          ],
          { geometry: away },
        ),
      ),
    ];
    const e = estimate(at('08:14'), c)!;
    near(e.pos, [(zh[0] + zug[0]) / 2, (zh[1] + zug[1]) / 2]);
  });
});

describe('shownPosition', () => {
  const now = at('08:14');
  const fix: Fix = { lat: 47.2, lon: 8.5, accuracy: 20, at: now };
  const est = estimate(now);

  it('a fresh, good location wins', () => {
    expect(shownPosition(est, fix, now)).toEqual({ source: 'location', fix });
  });

  it('a stale or rough one gives way to the estimate', () => {
    const stale = { ...fix, at: now - FIX_STALE_MS };
    const rough = { ...fix, accuracy: FIX_ROUGH_M + 1 };
    expect(shownPosition(est, stale, now)).toEqual({ source: 'estimate', estimate: est });
    expect(shownPosition(est, rough, now)).toEqual({ source: 'estimate', estimate: est });
  });

  it('without an estimate: a rough location still shows, a stale one does not', () => {
    const rough = { ...fix, accuracy: FIX_ROUGH_M + 1 };
    expect(shownPosition(null, rough, now)).toEqual({ source: 'location', fix: rough });
    expect(shownPosition(null, { ...fix, at: now - FIX_STALE_MS }, now)).toBeNull();
    expect(shownPosition(null, null, now)).toBeNull();
  });
});

describe('accuracyArea', () => {
  it('is closed and about the accuracy away from the fix; empty without a fix', () => {
    const fix: Fix = { lat: 46.8, lon: 9.5, accuracy: 500, at: 0 };
    const ring = accuracyArea(fix).features[0]!.geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring.at(-1));
    expect((ring[8]![1] - fix.lat) * 111_320).toBeCloseTo(500, 0);
    expect(accuracyArea(null).features).toEqual([]);
  });
});
