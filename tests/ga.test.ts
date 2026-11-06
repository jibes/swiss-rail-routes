// The GA data against rides as OJP gives them: a stretch is matched by the stops the ride itself
// calls at, so a fare named after a place's main station must be keyed on the stop the line
// leaves from (the Schilthornbahn from Mürren (Schilthornbahn), not Mürren BLM).
import { describe, expect, it } from 'vitest';
import type { GaData } from '../src/core/data';
import type { Section } from '../src/core/model';
import { gaRuleOf, gaUnknown } from '../src/core/warnings';
import gaJson from '../src/data/ga.json';

const ga = gaJson as unknown as GaData;
const call = (sloid: number, name: string) => ({ stopRef: `ch:1:sloid:${sloid}`, name });
const ride = (mode: Section['mode'], ...calls: ReturnType<typeof call>[]): Section => ({
  mode,
  from: calls[0]!,
  to: calls.at(-1)!,
  intermediate: calls.slice(1, -1),
});

describe('GA cover on the summit lines', () => {
  it('Mürren to Birg by the Schilthornbahn: half fare with a GA, either way', () => {
    const up = ride('cableCar', call(7455, 'Mürren (Schilthornbahn)'), call(7456, 'Birg'));
    expect(gaRuleOf(up, ga)).toBe('half');
    const down = ride('cableCar', call(7456, 'Birg'), call(7455, 'Mürren (Schilthornbahn)'));
    expect(gaRuleOf(down, ga)).toBe('half');
  });

  it('the train into Mürren is no part of it', () => {
    const train = ride('rail', call(7380, 'Grütschalp'), call(7379, 'Mürren BLM'));
    expect(gaRuleOf(train, ga)).toBeNull();
  });

  it('Gornergrat from Zermatt GGB and Pilatus from Alpnachstad PB, the stops they leave from', () => {
    const ids = (n: string) => ga.sections.find((x) => x.names.includes(n));
    expect(ids('Zermatt GGB')?.names).toContain('Gornergrat');
    expect(ids('Alpnachstad PB')?.names).toContain('Pilatus Kulm');
    expect(ids('Zermatt')).toBeUndefined();
  });
});

// Retest round 3, 6 Nov 2026: the Eiger Express and the Jungfraubahn from Eigergletscher said
// nothing with a GA. A cable car or cog railway needs evidence: a fare rule, or a GA fare of 0 in
// SBB's data (`covered`); without either its cover is not known, never taken as covered.
describe('GA cover not known', () => {
  it('the Eiger Express and the Jungfraubahn from Eigergletscher: no evidence either way', () => {
    expect(
      gaUnknown(ride('cableCar', call(7364, 'x'), call(7380, 'y')), { ...ga, covered: [] }),
    ).toBe(true);
    const eiger = ga.covered!.some((c) => c.names.join().includes('Eigergletscher'));
    expect(eiger).toBe(false);
  });

  it('Rigi and the Grütschalp cable car: covered by the evidence, said nothing', () => {
    const rigi = ga.covered!.find(
      (c) => c.names.includes('Rigi Kulm') && c.names.includes('Vitznau'),
    )!;
    expect(rigi).toBeDefined();
    const down = ride(
      'cog',
      { stopRef: rigi.from[0]!, name: rigi.names[0] },
      { stopRef: rigi.to[0]!, name: rigi.names[1] },
    );
    expect(gaUnknown(down, ga)).toBe(false);
    // The cable car leaves from its own stop beside the station the fare names.
    const cable = ride(
      'cableCar',
      call(7377, 'Lauterbrunnen (Seilbahn)'),
      call(7378, 'Grütschalp'),
    );
    expect(gaUnknown(cable, ga)).toBe(false);
  });

  it('a train or bus is never in doubt', () => {
    expect(gaUnknown(ride('rail', call(7364, 'x'), call(7380, 'y')), { ...ga, covered: [] })).toBe(
      false,
    );
    expect(gaUnknown(ride('bus', call(7364, 'x'), call(7380, 'y')), { ...ga, covered: [] })).toBe(
      false,
    );
  });
});
