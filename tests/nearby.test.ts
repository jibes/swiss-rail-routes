import { describe, expect, it } from 'vitest';
import { nearbyChoices, nearbyKm } from '../src/core/nearby';
import { stopKind } from '../src/core/stops';
import { index } from './helpers/timetable';

describe('a tap anywhere on the map planner', () => {
  it('how far follows the zoom: a tenth of the map for stations, closer for bus stops', () => {
    expect(nearbyKm(20)).toEqual({ stations: 2, others: 0.6666666666666666 });
    expect(nearbyKm(2)).toEqual({ stations: 1, others: 0.3 });
    expect(nearbyKm(1000)).toEqual({ stations: 15, others: 2 });
  });

  it('zoomed in on a village: its station first, then the bus stops by it', () => {
    // Grindelwald, beside the station.
    const c = nearbyChoices(index, { lat: 46.6243, lon: 8.0336 }, 5);
    expect(c[0]!.name).toBe('Grindelwald');
    expect(c[0]!.kind).toBe('train');
    expect(c.length).toBeLessThanOrEqual(5);
    expect(c.slice(1).some((x) => x.kind === 'bus')).toBe(true);
  });

  it('zoomed out over the countryside: stations from further, no bus stops far away', () => {
    const c = nearbyChoices(index, { lat: 46.75, lon: 7.8 }, 120);
    expect(c.length).toBeGreaterThan(0);
    for (const x of c.filter((x) => x.kind === 'bus')) expect(x.km).toBeLessThanOrEqual(2);
  });

  it('a stop by its most lasting way: a station with buses is a station', () => {
    expect(stopKind({ modes: ['TRAIN', 'BUS'] })).toBe('train');
    expect(stopKind({ modes: ['BUS'] })).toBe('bus');
    expect(stopKind({ modes: ['CABLE_CAR'] })).toBe('cable');
    expect(stopKind({ modes: ['BOAT', 'BUS'] })).toBe('boat');
  });
});
