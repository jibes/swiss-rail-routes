import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createStopSearch, fold, modeMask, toStop, type StopIndexFile } from '../src/core/stops';

const small: StopIndexFile = {
  v: 1,
  date: '2026-10-31',
  rows: [
    ['Zürich HB', 3000, 47.37818, 8.54021, modeMask(['TRAIN'])],
    ['Zürich, Bahnhofquai/HB', 91000, 47.377, 8.5418, modeMask(['TRAM', 'BUS'])],
    ['Zürich Oerlikon', 3006, 47.4115, 8.5444, modeMask(['TRAIN'])],
    ['Mürren BLM', 7379, 46.5596, 7.8925, modeMask(['TRAIN'])],
    ['Mürren, Dorf', 99000, 46.559, 7.892, modeMask(['BUS'])],
    ['St. Moritz', 9073, 46.498, 9.845, modeMask(['TRAIN'])],
    ['Bergün/Bravuogn', 9197, 46.629, 9.747, modeMask(['TRAIN'])],
  ],
};
const s = createStopSearch(small);
const names = (q: string) => s.search(q).map((x) => x.name);

describe('fold', () => {
  it('drops case, accents and punctuation', () => {
    expect(fold('Zürich HB')).toBe('zurich hb');
    expect(fold('Disentis/Mustér')).toBe('disentis muster');
    expect(fold('Gießen')).toBe('giessen');
  });
});

describe('stop search', () => {
  it('ranks rail stops and whole-name starts first', () => {
    expect(names('zur')).toEqual(['Zürich HB', 'Zürich Oerlikon', 'Zürich, Bahnhofquai/HB']);
    expect(names('Murren')[0]).toBe('Mürren BLM');
  });

  it('needs every word, each as a word start', () => {
    expect(names('zur oer')).toEqual(['Zürich Oerlikon']);
    expect(names('st mor')).toEqual(['St. Moritz']);
    expect(names('bravuogn')).toEqual(['Bergün/Bravuogn']);
    expect(names('urich')).toEqual([]);
  });

  it('ignores one-letter queries and honours the limit', () => {
    expect(names('z')).toEqual([]);
    expect(s.search('zu', 1)).toHaveLength(1);
  });

  it('maps rows to stops with SLOID and modes', () => {
    expect(s.byRef('ch:1:sloid:3000')).toEqual({
      ref: 'ch:1:sloid:3000',
      name: 'Zürich HB',
      lat: 47.37818,
      lon: 8.54021,
      modes: ['TRAIN'],
    });
    expect(toStop(small.rows[1]!).modes).toEqual(['TRAM', 'BUS']);
  });
});

describe('bundled index', () => {
  const file = JSON.parse(readFileSync('public/data/stops.v1.json', 'utf8')) as StopIndexFile;
  const real = createStopSearch(file);

  it('is complete enough to plan T1–T6', () => {
    expect(file.rows.length).toBeGreaterThan(20000);
    for (const name of [
      'Zürich HB',
      'Chur',
      'Filisur',
      'Preda',
      'Alp Grüm',
      'Sagliains',
      'Oberalppass',
      'Göschenen',
      'Wattwil',
      'Biberbrugg',
      'Brünig-Hasliberg',
      'Grütschalp',
      'Mürren BLM',
      'Rigi Kulm',
      'Vitznau',
      'Kleine Scheidegg',
      'Lugano',
      'Tirano',
    ])
      expect(real.search(name, 1)[0]?.name, name).toBe(name);
  });

  // Wide enough for German and Austrian rail stops; catches swapped lat/lon.
  it('has unique SLOIDs and coordinates in range', () => {
    const ids = new Set(file.rows.map((r) => r[1]));
    expect(ids.size).toBe(file.rows.length);
    for (const [, , lat, lon] of file.rows) {
      expect(lat).toBeGreaterThan(40);
      expect(lat).toBeLessThan(56);
      expect(lon).toBeGreaterThan(2);
      expect(lon).toBeLessThan(18);
    }
  });
});
