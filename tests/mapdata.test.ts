import { describe, expect, it } from 'vitest';
import { insertTemplate, newTour } from '../src/core/edit';
import { mapData } from '../src/core/mapdata';
import { conn, index, ref, ride, templates } from './helpers/timetable';

const stop = (r: string) => index.byRef(r);
const albula = templates.find((t) => t.id === 'albula')!;
const tour = insertTemplate(
  newTour('t', '2026-11-07', { stopRef: ref('Zürich HB'), name: 'Zürich HB' }),
  albula,
);

describe('mapData', () => {
  it('draws straight lines through the stops before planning, with template highlights', () => {
    const d = mapData(tour, undefined, templates, stop);
    expect(d.stops.features).toHaveLength(tour.waypoints.length);
    expect(d.lines.features).toHaveLength(1);
    expect(d.lines.features[0]!.properties.planned).toBe(false);
    expect(d.highlights.features.map((f) => f.properties.id)).toEqual([
      'landwasser',
      'albula-loops',
    ]);
    const [w, s, e, n] = d.bounds!;
    expect(w).toBeLessThan(8.6); // Zürich
    expect(e).toBeGreaterThan(9.8); // St. Moritz
    expect(s).toBeLessThan(n);
  });

  it('uses track geometry when present, else the calls', () => {
    const exact = ride(
      'IR 1',
      [
        ['Zürich HB', '08:00'],
        ['Chur', '09:15'],
      ],
      {
        geometry: [
          [8.54, 47.378],
          [9.0, 47.1],
          [9.53, 46.853],
        ],
      },
    );
    const plain = ride('RE 2', [
      ['Chur', '09:30'],
      ['Thusis', '09:55'],
      ['St. Moritz', '11:30'],
    ]);
    const d = mapData(tour, [conn(exact, plain)], templates, stop);
    expect(
      d.lines.features.map((f) => [f.properties.exact, f.geometry.coordinates.length]),
    ).toEqual([
      [true, 3],
      [false, 3],
    ]);
  });

  it('is empty for an empty tour', () => {
    expect(mapData(newTour('x', '2026-11-07'), undefined, templates, stop).bounds).toBeNull();
  });
});
