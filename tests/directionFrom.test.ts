import { describe, expect, it } from 'vitest';
import { stopKey } from '../src/core/stops';
import { directionFrom, TEMPLATES } from '../src/ui/TemplatePicker';
import { index } from './helpers/timetable';

const stop = (r: string) => index.byRef(stopKey(r));
const line = (id: string) => TEMPLATES.find((x) => x.id === id)!;
const from = (name: string) => index.search(name, 1)[0]!;

describe('which way a scenic line runs on from a station', () => {
  it('from Zürich: the Albula from Chur, the Voralpen-Express from Luzern', () => {
    const z = from('Zürich HB');
    expect(directionFrom(line('albula'), z, stop)).toBe(false);
    expect(directionFrom(line('voralpen-express'), z, stop)).toBe(true);
  });

  it('a summit line from its valley station, not the summit nearer as the crow flies', () => {
    // Rigi Kulm is 36.1 km from Zürich, Arth-Goldau 36.5: trains call at Arth-Goldau.
    expect(directionFrom(line('rigi-arth'), from('Zürich HB'), stop)).toBe(false);
    // Standing at the valley station itself: from there.
    expect(directionFrom(line('rigi-arth'), from('Arth-Goldau'), stop)).toBe(false);
  });

  it('nothing known: as written', () => {
    expect(directionFrom(line('albula'), undefined, stop)).toBe(false);
    expect(directionFrom(line('albula'), from('Zürich HB'), () => undefined)).toBe(false);
  });
});
