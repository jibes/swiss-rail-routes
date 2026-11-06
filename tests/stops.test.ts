import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createStopSearch,
  fold,
  modeMask,
  stopKey,
  toStop,
  withinOne,
  type StopIndexFile,
} from '../src/core/stops';
import { index } from './helpers/timetable';

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

// Reported on the MCP, 5 Nov 2026: "Goeschenen" found nothing. ö, ü, ä are also written oe, ue,
// ae; both sides are folded alike, so every spelling finds the stop.
describe('umlauts written out', () => {
  it('Goeschenen, Goschenen and Gö all find Göschenen; Bruenig finds Brünig', () => {
    const real = createStopSearch(
      JSON.parse(readFileSync('public/data/stops.v1.json', 'utf8')) as StopIndexFile,
    );
    for (const q of ['Goeschenen', 'Goschenen', 'Göschenen', 'Gösch'])
      expect(
        real.search(q, 3).map((x) => x.name),
        q,
      ).toContain('Göschenen');
    expect(
      real
        .search('Bruenig', 5)
        .map((x) => x.name)
        .join(),
    ).toMatch(/Brünig/);
    expect(real.search('Zuerich HB', 1)[0]?.name).toBe('Zürich HB');
    // Names written with "ue" or "oe" themselves still find themselves.
    for (const q of ['Bouveret', 'Oerlikon', 'Hauenstein'])
      expect(real.search(q, 3).length, q).toBeGreaterThan(0);
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

// Stops abroad DIDOK does not list (0.19.0): OJP knows them by their UIC number only, and
// refuses `ch:1:sloid:8774678`; Swiss DIDOK numbers still become SLOIDs.
describe('stops abroad', () => {
  const file = JSON.parse(readFileSync('public/data/stops.v1.json', 'utf8')) as StopIndexFile;
  const real = createStopSearch(file);
  it('keep their UIC number as ref and key', () => {
    for (const [name, uic] of [
      ['Chamonix-Mont-Blanc', '8774678'],
      ['Vallorcine', '8774687'],
      ['Domodossola', '8301003'],
    ] as const) {
      expect(real.search(name)[0]).toMatchObject({ name, ref: uic });
      expect(stopKey(uic)).toBe(uic);
      expect(real.byRef(stopKey(uic))?.name).toBe(name);
    }
    expect(stopKey('8503000')).toBe('ch:1:sloid:3000');
  });
});

describe('stops near a point', () => {
  it('rail, cable and boat stops within reach, nearest first, with their distance', () => {
    const near = s.near({ lat: 47.37818, lon: 8.54021 }, 5);
    expect(near.map((x) => x.name)).toEqual(['Zürich HB', 'Zürich Oerlikon']);
    expect(near[0]!.km).toBe(0);
    expect(near[1]!.km).toBeGreaterThan(3);
    expect(s.near({ lat: 47.37818, lon: 8.54021 }, 1).map((x) => x.name)).toEqual(['Zürich HB']);
  });
});

// Retest round 3, 6 Nov 2026: "Gare de Lausane" found nothing. One letter wrong, missing, extra
// or swapped in a word of 5+ letters (a shorter one while another word is right), after every
// exact hit; words a station's name may leave out (Gare, Bahnhof…) count as matched.
describe('a typo in the stop search', () => {
  const first = (q: string) => index.search(q, 8)[0]?.name;
  it('finds the stop', () => {
    expect(first('Gare de Lausane')).toBe('Lausanne');
    expect(first('Lausane')).toBe('Lausanne');
    expect(first('Interlaken Ots')).toBe('Interlaken Ost');
    expect(first('Grindelwlad')).toBe('Grindelwald');
  });
  it('never before an exact hit, and nothing from noise', () => {
    expect(first('Bern')).toBe('Bern');
    expect(index.search('xyzzyq', 8)).toEqual([]);
    expect(index.search('Zug', 8).length).toBeLessThanOrEqual(8);
  });
  it('one edit at most', () => {
    expect(withinOne('lausane', 'lausann')).toBe(true);
    expect(withinOne('grindelwlad', 'grindelwald')).toBe(true);
    expect(withinOne('lausne', 'lausanne')).toBe(false);
  });
});
