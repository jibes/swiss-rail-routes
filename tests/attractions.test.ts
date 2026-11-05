import { describe, expect, it } from 'vitest';
import { searchAttractions, walkMinutes, type AttractionData } from '../src/core/attractions';
import { kmBetween, stopKey } from '../src/core/stops';
import data from '../src/data/attractions.json';
import { index } from './helpers/timetable';

const places = data as AttractionData;
const at = (r: string) => index.byRef(stopKey(r));

describe('places people go to by train (curated)', () => {
  it('each in four languages, in Switzerland or by its border, with stops the index knows', () => {
    expect(places.attractions.length).toBeGreaterThanOrEqual(30);
    expect(new Set(places.attractions.map((a) => a.id)).size).toBe(places.attractions.length);
    for (const a of places.attractions) {
      for (const l of ['en', 'de', 'fr', 'it'] as const)
        expect(a.name[l]?.trim(), a.id).toBeTruthy();
      expect(a.lat).toBeGreaterThan(45.7);
      expect(a.lat).toBeLessThan(47.9);
      expect(a.lon).toBeGreaterThan(5.9);
      expect(a.lon).toBeLessThan(10.6);
      expect(a.stops.length, a.id).toBeGreaterThan(0);
      for (const s of a.stops) {
        const stop = at(s.ref);
        // The stop by its ref, under the name written beside it, and near the place.
        expect(stop?.name, `${a.id}: ${s.name}`).toBe(s.name);
        expect(kmBetween(a, stop!), `${a.id}: ${s.name}`).toBeLessThan(2.5);
      }
    }
  });

  it('a walk estimated from the straight line, a little longer, with the way out of the station', () => {
    // Retest, 5 Nov 2026: Melide → Swissminiatur said 1 min, really 3–5.
    expect(walkMinutes(0)).toBe(2);
    expect(walkMinutes(1)).toBe(20);
    expect(walkMinutes(0.3)).toBe(8);
  });

  it('found by any of their names, with their stops and the walk from each', () => {
    const one = (q: string, lang: 'en' | 'de' | 'fr' | 'it' = 'en') =>
      searchAttractions(places, q, lang, at)[0];
    // Curated where the real walk is known (the retest's 3–5 min), an estimate elsewhere.
    expect(one('Swissminiatur')?.stops[0]).toMatchObject({
      name: 'Melide',
      walkMin: 4,
      estimate: false,
    });
    expect(one('Swissminiatur')?.stops[1]).toMatchObject({ estimate: true });
    for (const q of ['Rhine Falls', 'Rheinfall', 'chutes du rhin', 'cascate'])
      expect(one(q)?.id, q).toBe('rheinfall');
    expect(one('Rheinfall', 'fr')?.name).toBe('Chutes du Rhin');
    expect(one('Verkehrshaus')?.stops.map((s) => s.name)).toContain('Luzern Verkehrshaus');
    expect(one('Chateau de Chillon')?.id).toBe('chillon');
    expect(searchAttractions(places, 'zz', 'en', at)).toEqual([]);
    expect(one('Bundeshaus')?.stops[0]).toMatchObject({ name: 'Bern, Bundesplatz' });
  });
});
