import { describe, expect, it } from 'vitest';
import type { Tour, Waypoint } from '../src/core/model';
import { expandLegs, isRoundTrip, totalDwellMin } from '../src/core/tour';

const wp = (name: string, kind: Waypoint['kind'], dwellMin = 0): Waypoint => ({
  stopRef: `ch:1:sloid:${name}`,
  name,
  kind,
  dwellMin,
});

const tour = (waypoints: Waypoint[]): Tour => ({
  id: 't',
  name: 'T',
  date: '2026-11-07',
  anchor: { departAt: '07:00' },
  ticket: 'GA',
  travelClass: 2,
  waypoints,
  schema: 1,
});

// T3 shape: St. Gallen → Wattwil → Luzern (60) → Brünig → Interlaken → Mürren (60) → … → St. Gallen
const t3 = tour([
  wp('StGallen', 'start'),
  wp('Wattwil', 'via'),
  wp('Luzern', 'stop', 60),
  wp('Bruenig', 'via'),
  wp('Interlaken', 'via'),
  wp('Muerren', 'stop', 60),
  wp('Bern', 'via'),
  wp('StGallen', 'end'),
]);

describe('expandLegs', () => {
  it('splits at stops and keeps vias on their leg', () => {
    const legs = expandLegs(t3);
    expect(legs.map((l) => [l.from.name, l.to.name, l.vias.map((v) => v.name)])).toEqual([
      ['StGallen', 'Luzern', ['Wattwil']],
      ['Luzern', 'Muerren', ['Bruenig', 'Interlaken']],
      ['Muerren', 'StGallen', ['Bern']],
    ]);
    expect(legs.map((l) => l.index)).toEqual([0, 1, 2]);
  });

  it('returns no legs for fewer than two waypoints', () => {
    expect(expandLegs(tour([]))).toEqual([]);
    expect(expandLegs(tour([wp('A', 'start')]))).toEqual([]);
  });
});

describe('isRoundTrip', () => {
  it('is true when the last waypoint is the first', () => {
    expect(isRoundTrip(t3)).toBe(true);
    expect(isRoundTrip(tour([wp('A', 'start'), wp('B', 'end')]))).toBe(false);
    expect(isRoundTrip(tour([wp('A', 'start')]))).toBe(false);
  });
});

describe('totalDwellMin', () => {
  it('sums stops and turnarounds only', () => {
    expect(totalDwellMin(t3)).toBe(120);
    expect(totalDwellMin(tour([wp('A', 'via', 30), wp('B', 'turnaround', 30)]))).toBe(30);
  });
});
