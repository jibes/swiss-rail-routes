// A train's notice counts against the plan only when it concerns the stretch you ride.
import { describe, expect, it } from 'vitest';
import type { Section } from '../src/core/model';
import { onThisStretch, stretchOf } from '../src/core/warnings';

const call = (name: string) => ({ stopRef: name, name });
const ride = (names: string[], notices: string[]): Section => ({
  mode: 'rail',
  from: call(names[0]!),
  to: call(names.at(-1)!),
  intermediate: names.slice(1, -1).map(call),
  situationIds: ['x'],
  notices,
});

describe('a notice and the stretch you ride', () => {
  it('reads the two ends a notice names, in each language', () => {
    expect(
      stretchOf('Der Bahnverkehr zwischen Lausanne und Genève-Aéroport ist eingeschränkt.'),
    ).toEqual(['Lausanne', 'Genève-Aéroport']);
    expect(stretchOf('Trafic interrompu entre Brig et Domodossola.')).toEqual([
      'Brig',
      'Domodossola',
    ]);
    expect(stretchOf('Traffico interrotto tra Bellinzona e Lugano.')).toEqual([
      'Bellinzona',
      'Lugano',
    ]);
    expect(stretchOf('Signal fault, delays expected.')).toBeUndefined();
  });
  it('the IC1 Bern–Zürich with works between Lausanne and Genève: not on your stretch', () => {
    const s = ride(
      ['Bern', 'Zürich HB'],
      ['Der Bahnverkehr zwischen Lausanne und Genève-Aéroport ist eingeschränkt.'],
    );
    expect(onThisStretch(s)).toBe(false);
  });
  it('an end you pass, or a notice naming no stretch: on your stretch', () => {
    const s = ride(
      ['Interlaken West', 'Spiez', 'Bern'],
      ['Der Bahnverkehr zwischen Interlaken Ost und Interlaken West ist unterbrochen.'],
    );
    expect(onThisStretch(s)).toBe(true);
    expect(onThisStretch(ride(['Bern', 'Zürich HB'], ['Personenunfall, Verspätungen.']))).toBe(
      true,
    );
    // Notices with no text: as before, a disruption.
    expect(onThisStretch(ride(['Bern', 'Zürich HB'], []))).toBe(true);
  });
});
